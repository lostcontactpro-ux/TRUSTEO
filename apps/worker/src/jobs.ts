import { randomUUID } from 'node:crypto';
import { UnrecoverableError } from 'bullmq';
import { Resend } from 'resend';
import webpush from 'web-push';
import { createProvider, ProviderError, type ProviderCredentials } from '@trusteo/core/providers/index';
import { decryptCredentials, encryptCredentials } from '@trusteo/core/crypto';
import { isEntitled } from '@trusteo/core/pricing';
import { campaignInput, eligibleContact, renderInvitation } from '@trusteo/core/campaigns';
import { db, deliveryQueue, jobOptions, notificationQueue, redis, syncQueue } from './runtime';
import { escapedHtml, insideIdempotencyWindow, reviewFields, reviewNotification, safeFailure, safePushEndpoint } from './policy';

function origin() {
  const url = new URL(process.env.APP_URL ?? 'http://localhost:3000');
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new UnrecoverableError('APP_URL must use HTTPS.');
  return url.origin;
}
function mailReady() { return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM); }
function pushReady() { return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT); }
async function sendEmail(input: { to: string; subject: string; text: string; key: string }) {
  if (!mailReady()) throw new Error('email_configuration_required');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM!, to: input.to, subject: input.subject, text: input.text,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;white-space:pre-wrap">${escapedHtml(input.text)}</div>`,
  }, { idempotencyKey: input.key });
  if (error) throw new Error('email_delivery_failed');
}

/** Repeatable dispatcher also recovers inserts committed before queue enqueue. */
export async function dispatch() {
  const connections = await db.providerConnection.findMany({ where: { status: 'connected', mode: 'api' }, include: { location: { include: { user: { include: { subscription: true } } } } } });
  const bucket = Math.floor(Date.now() / 600_000);
  await syncQueue.addBulk(connections.filter(c => isEntitled(c.location.user.subscription)).map(c => ({ name: 'sync-connection', data: { connectionId: c.id }, opts: { ...jobOptions, backoff: { type: 'provider', delay: 10000 }, jobId: `sync-${c.id}-${bucket}` } })));
  // Notification is the transactional outbox; the queue can be rebuilt after Redis loss.
  const notifications = await db.notification.findMany({ where: { reviewId: { not: null }, OR: [{ emailSentAt: null }, { pushSentAt: null }] }, include: { user: true } });
  const pending = notifications.filter(n => (n.user.notifyEmail && !n.emailSentAt && mailReady() && (!n.emailAttemptedAt || insideIdempotencyWindow(n.emailAttemptedAt))) || (n.user.notifyPush && !n.pushSentAt && pushReady()));
  for (const n of pending) {
    const id = `notice-${n.reviewId}`; const old = await notificationQueue.getJob(id);
    if (old && await old.getState() === 'failed') await old.retry();
    else {
      if (old && await old.getState() === 'completed') await old.remove();
      await notificationQueue.add('new-review', { reviewId: n.reviewId }, { ...jobOptions, jobId: id });
    }
  }
  // Recover scheduled campaigns whose initial queue insertion was interrupted.
  const recipients = await db.campaignRecipient.findMany({ where: { status: { in: ['pending', 'retry'] }, campaign: { status: { in: ['queued', 'sending'] } } }, select: { id: true } });
  await deliveryQueue.addBulk(recipients.map(r => ({ name: 'campaign-recipient', data: { recipientId: r.id }, opts: { ...jobOptions, jobId: `recipient-${r.id}` } })));
  // Retain only operational counters, not an unbounded list of stale auth keys.
  await db.rateLimit.deleteMany({ where: { resetAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.passwordReset.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}

export async function syncConnection(connectionId: string) {
  const lockKey = `trusteo:sync-lock:${connectionId}`; const lockToken = randomUUID();
  if (!await redis.set(lockKey, lockToken, 'PX', 300_000, 'NX')) return;
  let lostLock = false;
  const renewal = setInterval(() => {
    void redis.eval('if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end', 1, lockKey, lockToken, 300_000).then(result => { if (result !== 1) lostLock = true; }).catch(() => { lostLock = true; });
  }, 60_000);
  let logId: string | undefined;
  try {
    const connection = await db.providerConnection.findUnique({ where: { id: connectionId }, include: { location: { include: { user: { include: { subscription: true } } } } } });
    if (!connection || connection.mode !== 'api' || connection.status !== 'connected' || !isEntitled(connection.location.user.subscription)) return;
    logId = (await db.syncLog.create({ data: { connectionId, status: 'running' } })).id;
    if (!connection.credentials) throw new ProviderError('Encrypted credentials are required.', 'configuration');
    const credentials = decryptCredentials<ProviderCredentials>(connection.credentials);
    const prefix = connection.platform === 'google' ? 'GOOGLE' : 'TRUSTPILOT';
    const provider = createProvider(connection.platform, {
      locationId: connection.locationId, credentials,
      oauth: { clientId: process.env[`${prefix}_CLIENT_ID`] ?? '', clientSecret: process.env[`${prefix}_CLIENT_SECRET`] ?? '', redirectUri: `${origin()}/api/connections/oauth/callback` },
      onTokens: async tokens => { await db.providerConnection.update({ where: { id: connectionId }, data: { credentials: encryptCredentials(tokens) } }); },
    });
    const startedAt = new Date();
    const since = connection.lastSyncedAt ? new Date(connection.lastSyncedAt.getTime() - 300_000) : undefined;
    const reviews = await provider.fetchReviews(since);
    if (lostLock) throw new Error('sync_lock_lost');
    let inserted = 0;
    for (const review of reviews) {
      if (lostLock) throw new Error('sync_lock_lost');
      const created = await db.$transaction(async tx => {
        const previous = await tx.review.findUnique({ where: { connectionId_externalId: { connectionId, externalId: review.externalId } } });
        if (previous) {
          // Keep the owner's local reply; enrich only when an upstream reply is present.
          await tx.review.update({ where: { id: previous.id }, data: { ...reviewFields(review), ...(review.reply ? { replyText: review.reply, status: 'replied' } : {}) } });
          return null;
        }
        const item = await tx.review.create({ data: { ...reviewFields(review), connectionId, locationId: connection.locationId, status: review.responseStatus, ...(review.reply ? { replyText: review.reply } : {}) } });
        const notice = reviewNotification(review.rating, connection.location.name);
        await tx.notification.create({ data: { id: `review-${item.id}`, userId: connection.location.userId, reviewId: item.id, ...notice, url: '/app/reviews' } });
        return item;
      });
      if (created) {
        inserted++;
        await notificationQueue.add('new-review', { reviewId: created.id }, { ...jobOptions, jobId: `notice-${created.id}` });
      }
    }
    await db.providerConnection.update({ where: { id: connectionId }, data: { lastSyncedAt: startedAt, lastError: null } });
    await db.syncLog.update({ where: { id: logId }, data: { status: 'success', fetched: inserted, completedAt: new Date() } });
  } catch (error) {
    const safe = safeFailure(error);
    if (logId) await db.syncLog.update({ where: { id: logId }, data: { status: 'failed', error: safe, completedAt: new Date() } });
    await db.providerConnection.updateMany({ where: { id: connectionId }, data: { lastError: safe, ...(error instanceof ProviderError && error.code === 'authorization' ? { status: 'pending' } : {}) } });
    if (error instanceof ProviderError && !error.retryable) throw new UnrecoverableError(safe);
    throw error instanceof ProviderError ? error : new Error(safe);
  } finally {
    clearInterval(renewal);
    await redis.eval('if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end', 1, lockKey, lockToken);
  }
}

export async function notifyReview(reviewId: string) {
  const notice = await db.notification.findUnique({ where: { reviewId }, include: { user: { include: { pushSubscriptions: true, subscription: true } } } });
  if (!notice || !isEntitled(notice.user.subscription)) return;
  if (notice.user.notifyEmail && !notice.emailSentAt && mailReady()) {
    if (notice.emailAttemptedAt && !insideIdempotencyWindow(notice.emailAttemptedAt)) throw new UnrecoverableError('email_idempotency_window_expired_manual_check_required');
    if (!notice.emailAttemptedAt) await db.notification.update({ where: { id: notice.id }, data: { emailAttemptedAt: new Date() } });
    await sendEmail({ to: notice.user.email, subject: notice.title, text: `${notice.body}\n\nConsultez et répondez à votre avis : ${origin()}/app/reviews\n\nPréférences de notification : ${origin()}/app/settings`, key: `review-${reviewId}` });
    await db.notification.update({ where: { id: notice.id }, data: { emailSentAt: new Date() } });
  }
  if (notice.user.notifyPush && !notice.pushSentAt && pushReady()) {
    for (const sub of notice.user.pushSubscriptions) {
      if (!safePushEndpoint(sub.endpoint)) { await db.pushSubscription.delete({ where: { id: sub.id } }); continue; }
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({ title: notice.title, body: notice.body, url: '/app/reviews', tag: `review-${reviewId}` }), { vapidDetails: { subject: process.env.VAPID_SUBJECT!, publicKey: process.env.VAPID_PUBLIC_KEY!, privateKey: process.env.VAPID_PRIVATE_KEY! }, timeout: 20000, TTL: 86400 });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db.pushSubscription.deleteMany({ where: { id: sub.id } });
        else throw new Error('push_delivery_failed');
      }
    }
    await db.notification.update({ where: { id: notice.id }, data: { pushSentAt: new Date() } });
  }
}

async function finishCampaign(campaignId: string) {
  const remaining = await db.campaignRecipient.count({ where: { campaignId, status: { in: ['pending', 'sending', 'retry'] } } });
  if (remaining) return;
  const errors = await db.campaignRecipient.count({ where: { campaignId, status: { in: ['failed', 'delivery_unknown'] } } });
  await db.campaign.updateMany({ where: { id: campaignId }, data: { status: errors ? 'completed_with_errors' : 'completed', sentAt: new Date() } });
}

export async function deliverRecipient(recipientId: string) {
  const item = await db.campaignRecipient.findUnique({ where: { id: recipientId }, include: { contact: true, campaign: { include: { location: true, user: { include: { subscription: true } } } } } });
  if (!item || item.sentAt || ['sent', 'skipped', 'failed', 'delivery_unknown'].includes(item.status)) return;
  const { campaign, contact } = item;
  if (contact.userId !== campaign.userId || campaign.location.userId !== campaign.userId) throw new UnrecoverableError('tenant_mismatch');
  if (!isEntitled(campaign.user.subscription)) throw new UnrecoverableError('subscription_required');
  if (!['queued', 'sending'].includes(campaign.status)) return;
  const channel = campaign.channel === 'sms' ? 'sms' : 'email';
  if (!eligibleContact(contact, channel)) {
    await db.campaignRecipient.update({ where: { id: item.id }, data: { status: 'skipped', error: 'consent_missing_or_unsubscribed' } }); await finishCampaign(campaign.id); return;
  }
  // Re-validate saved campaigns so changing the public API cannot bypass rules.
  campaignInput.parse({ name: campaign.name, locationId: campaign.locationId, channel, message: campaign.message, offer: campaign.offer || undefined });
  const reviewUrl = campaign.location.reviewUrl;
  if (!reviewUrl || !reviewUrl.startsWith('https://')) throw new UnrecoverableError('https_review_url_required');
  if (item.deliveryStartedAt && !insideIdempotencyWindow(item.deliveryStartedAt)) {
    await db.campaignRecipient.update({ where: { id: item.id }, data: { status: 'delivery_unknown', error: 'idempotency_window_expired_manual_check_required' } }); await finishCampaign(campaign.id); return;
  }
  if (channel === 'sms' && item.status === 'sending') {
    await db.campaignRecipient.update({ where: { id: item.id }, data: { status: 'delivery_unknown', error: 'sms_delivery_requires_manual_check' } }); await finishCampaign(campaign.id); return;
  }
  const content = renderInvitation({ businessName: campaign.location.name, reviewUrl, message: campaign.message, unsubscribeUrl: `${origin()}/unsubscribe?token=${encodeURIComponent(contact.unsubscribeToken)}` });
  await db.campaignRecipient.update({ where: { id: item.id }, data: { status: 'sending', deliveryStartedAt: item.deliveryStartedAt ?? new Date(), error: null } });
  try {
    if (channel === 'email') await sendEmail({ to: contact.email, ...content, key: `recipient-${item.id}` });
    else {
      if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM) throw new UnrecoverableError('sms_configuration_required');
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(process.env.TWILIO_ACCOUNT_SID)}/Messages.json`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ From: process.env.TWILIO_FROM, To: contact.phone!, Body: content.text }), signal: AbortSignal.timeout(20000) });
      if (!response.ok) {
        if (response.status === 429) {
          await db.campaignRecipient.update({ where: { id: item.id }, data: { status: 'retry', error: 'sms_rate_limited' } }); throw new Error('sms_rate_limited');
        }
        if (response.status < 500) throw new UnrecoverableError('sms_request_rejected');
        throw new Error('sms_delivery_uncertain');
      }
    }
    await db.campaignRecipient.update({ where: { id: item.id }, data: { status: 'sent', sentAt: new Date() } });
    await finishCampaign(campaign.id);
  } catch (error) {
    if (channel === 'email') {
      await db.campaignRecipient.update({ where: { id: item.id }, data: { status: 'retry', error: 'email_delivery_failed' } });
    } else if (error instanceof UnrecoverableError) {
      await db.campaignRecipient.update({ where: { id: item.id }, data: { status: 'failed', error: error.message } }); await finishCampaign(campaign.id);
    }
    // SMS unknown outcomes remain 'sending'; retries mark them unknown without
    // repeating a possibly accepted, non-idempotent external request.
    throw error instanceof UnrecoverableError ? error : new Error(channel === 'sms' ? 'sms_delivery_retry_or_unknown' : 'email_delivery_failed');
  }
}
