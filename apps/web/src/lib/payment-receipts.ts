import type Stripe from 'stripe';
import { Prisma, type PaymentReceipt } from '@prisma/client';
import { decryptCredentials, encryptCredentials } from '@trusteo/core/crypto';
import { db } from './db';
import { appUrl } from './billing';
import { paymentEmail, selectionFromPaymentLinkUrl, validateSubscriptionPrice, assertNoAnnualTrial, type PaymentSelection } from './payment-link-validation';
import { stripeId, subscriptionEntitlementData } from './billing-subscriptions';
import { hashToken, HttpError, token } from './security';
import { escapeHtml, mailConfigured, sendMail } from './mail';

const RECEIPT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export async function validatePaymentLinkSession(stripe: Stripe, sessionId: string) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const paymentLinkId = stripeId(session.payment_link);
  const subscriptionId = stripeId(session.subscription);
  const customerId = stripeId(session.customer);
  if (!paymentLinkId || !subscriptionId || !customerId || session.mode !== 'subscription' || session.status !== 'complete') throw new HttpError(409, 'Ce paiement ne correspond pas à un abonnement Payment Link confirmé.');
  const link = await stripe.paymentLinks.retrieve(paymentLinkId);
  const selection = selectionFromPaymentLinkUrl(link.url);
  if (!selection) throw new HttpError(409, 'Ce Payment Link ne fait pas partie des tarifs Trusteo.');
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['default_payment_method'] });
  if (stripeId(subscription.customer) !== customerId) throw new HttpError(409, 'Le titulaire de l’abonnement ne correspond pas au paiement.');
  validateSubscriptionPrice(subscription, selection);
  const lines = await stripe.paymentLinks.listLineItems(paymentLinkId, { limit: 2 });
  if (lines.has_more || lines.data.length !== 1 || lines.data[0].quantity !== 1 || lines.data[0].price?.id !== subscription.items.data[0].price.id) throw new HttpError(409, 'Le contenu du Payment Link ne correspond pas au tarif de l’abonnement.');
  if (selection.interval === 'year' && subscription.status === 'active' && session.payment_status !== 'paid') {
    const invoiceId = stripeId(subscription.latest_invoice);
    const invoice = invoiceId ? await stripe.invoices.retrieve(invoiceId) : null;
    if (!invoice || invoice.status !== 'paid' || invoice.amount_paid <= 0) throw new HttpError(409, 'Le paiement annuel doit être confirmé avant l’activation.');
  }
  const email = paymentEmail(session);
  return { session, subscription, selection, customerId, paymentLinkId, email };
}

export async function retainPaymentReceipt(stripe: Stripe, sessionId: string): Promise<PaymentReceipt> {
  const verified = await validatePaymentLinkSession(stripe, sessionId);
  if (verified.session.payment_status !== 'paid' && verified.session.payment_status !== 'no_payment_required') throw new HttpError(503, 'La confirmation du paiement Stripe est encore en attente.');
  const raw = token();
  let receipt: PaymentReceipt;
  try {
    receipt = await db.paymentReceipt.create({ data: {
      checkoutSessionId: sessionId, paymentLinkId: verified.paymentLinkId, stripeCustomerId: verified.customerId,
      stripeSubscriptionId: verified.subscription.id, email: verified.email, ...verified.selection,
      tokenHash: hashToken(raw), tokenEnvelope: encryptCredentials({ token: raw }), expiresAt: new Date(Date.now() + RECEIPT_LIFETIME_MS),
    } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    receipt = await db.paymentReceipt.findUniqueOrThrow({ where: { checkoutSessionId: sessionId } });
  }
  // A durable receipt exists before either trial verification or mail delivery.
  // A retry recovers the same token and never silently drops an anonymous payer.
  await subscriptionEntitlementData(stripe, verified.subscription, verified.selection, verified.email);
  return receipt;
}

export async function emailPaymentReceipt(receipt: PaymentReceipt): Promise<void> {
  if (receipt.emailedAt || receipt.claimedAt) return;
  if (!mailConfigured()) throw new HttpError(503, 'Configurez Resend et le domaine email pour rattacher les paiements.');
  if (!receipt.tokenEnvelope) throw new HttpError(409, 'Le lien de rattachement doit être renouvelé.');
  const raw = decryptCredentials<{ token: string }>(receipt.tokenEnvelope).token;
  const link = `${appUrl()}/signup?paymentToken=${encodeURIComponent(raw)}`;
  await sendMail({ to: receipt.email, subject: 'Rattachez votre abonnement Trusteo à votre compte', idempotencyKey: `payment-claim-${receipt.id}-${receipt.tokenHash.slice(0, 12)}`,
    text: `Votre paiement Stripe a été enregistré. Créez un compte ou connectez-vous avec cette même adresse email, puis rattachez votre abonnement avec ce lien personnel valable 7 jours : ${link}\nNe partagez pas ce lien. Aucun nouveau paiement n’est nécessaire. Les essais ne concernent que les formules mensuelles, une seule fois par titulaire et carte.`,
    html: `<p>Votre paiement Stripe a été enregistré.</p><p>Créez un compte ou connectez-vous avec cette même adresse email, puis <a href="${escapeHtml(link)}">rattachez votre abonnement Trusteo</a>. Aucun nouveau paiement n’est nécessaire.</p><p>Ce lien personnel est valable 7 jours. Ne le partagez pas. Les essais concernent uniquement les formules mensuelles, une seule fois par titulaire et carte.</p>`,
  });
  await db.paymentReceipt.updateMany({ where: { id: receipt.id, tokenHash: receipt.tokenHash, claimedAt: null, emailedAt: null }, data: { emailedAt: new Date() } });
}

export async function claimPaymentReceipt(stripe: Stripe, userId: string, raw: string) {
  const hash = hashToken(raw);
  const original = await db.paymentReceipt.findUnique({ where: { tokenHash: hash } });
  if (!original || original.claimedAt || original.expiresAt <= new Date()) throw new HttpError(409, 'Lien de rattachement expiré, déjà utilisé ou invalide.');
  const requestingUser = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
  if (requestingUser.email.trim().toLowerCase() !== original.email) throw new HttpError(403, 'Connectez-vous avec l’adresse email utilisée lors du paiement.');
  const verificationStartedAt = new Date();
  const verified = await validatePaymentLinkSession(stripe, original.checkoutSessionId);
  assertNoAnnualTrial(verified.subscription, verified.selection);
  if (!['active', 'trialing'].includes(verified.subscription.status)) {
    if (verified.subscription.trial_start) {
      // Mailbox proof is valid, but the external trial was canceled. Remember
      // its use without granting rights or binding a canceled paid contract.
      // This lets the authenticated checkout offer a paid monthly plan directly.
      await db.subscription.updateMany({ where: { userId }, data: { trialUsed: true } });
      throw new HttpError(409, 'Cet essai a été annulé ou est terminé. Souscrivez un abonnement payant depuis Paramètres, sans nouvel essai.');
    }
    throw new HttpError(409, 'Cet abonnement n’est pas actif. Souscrivez un abonnement depuis Paramètres ou contactez Trusteo.');
  }
  const snapshot = await subscriptionEntitlementData(stripe, verified.subscription, verified.selection, original.email);
  if (!['active', 'trialing'].includes(snapshot.status)) throw new HttpError(409, 'Cet essai a déjà été utilisé. Aucun nouvel essai ne peut être activé.');
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "PaymentReceipt" WHERE id=${original.id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Subscription" WHERE "userId"=${userId} FOR UPDATE`;
    const [user, receipt, current] = await Promise.all([
      tx.user.findUniqueOrThrow({ where: { id: userId } }),
      tx.paymentReceipt.findUniqueOrThrow({ where: { id: original.id } }),
      tx.subscription.findUnique({ where: { userId } }),
    ]);
    if (receipt.tokenHash !== hash || receipt.claimedAt || receipt.expiresAt <= new Date()) throw new HttpError(409, 'Lien de rattachement expiré, déjà utilisé ou invalide.');
    if (user.email.trim().toLowerCase() !== receipt.email || verified.email !== receipt.email) throw new HttpError(403, 'Connectez-vous avec l’adresse email utilisée lors du paiement.');
    if (receipt.stripeCustomerId !== verified.customerId || receipt.stripeSubscriptionId !== verified.subscription.id || receipt.plan !== verified.selection.plan || receipt.interval !== verified.selection.interval) throw new HttpError(409, 'Le paiement a changé et nécessite une vérification.');
    if (current?.checkoutSessionId || current?.stripeSubscriptionId && current.stripeSubscriptionId !== receipt.stripeSubscriptionId && !['canceled', 'incomplete_expired'].includes(current.status)) throw new HttpError(409, 'Votre compte possède déjà un abonnement ou un paiement en cours.');
    const deferred = await tx.deferredStripeEvent.findMany({ where: { stripeSubscriptionId: receipt.stripeSubscriptionId, resolvedAt: null }, select: { eventCreated: true, receivedAt: true } });
    if (current && current.updatedAt > verificationStartedAt || deferred.some(event => event.receivedAt > verificationStartedAt)) throw new HttpError(409, 'Le paiement vient de changer. Réessayez le rattachement pour vérifier son état actuel.');
    const stripeEventCreated = Math.max(current?.stripeEventCreated || 0, ...deferred.map(event => event.eventCreated));
    const data = { ...snapshot, stripeCustomerId: receipt.stripeCustomerId, trialUsed: current?.trialUsed || snapshot.trialUsed, stripeEventCreated, checkoutSessionId: null, checkoutExpiresAt: null };
    await tx.subscription.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    await tx.paymentReceipt.update({ where: { id: receipt.id }, data: { claimedAt: new Date(), claimedUserId: userId, tokenEnvelope: null } });
    await tx.deferredStripeEvent.updateMany({ where: { stripeSubscriptionId: receipt.stripeSubscriptionId, resolvedAt: null }, data: { resolvedAt: new Date() } });
    return { claimed: true, plan: snapshot.plan, interval: snapshot.interval, status: snapshot.status };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function expectedPaymentSelection(subscriptionId: string): Promise<PaymentSelection | undefined> {
  const receipt = await db.paymentReceipt.findUnique({ where: { stripeSubscriptionId: subscriptionId } });
  if (!receipt || !['essential', 'pro'].includes(receipt.plan) || !['month', 'year'].includes(receipt.interval)) return undefined;
  return { plan: receipt.plan, interval: receipt.interval } as PaymentSelection;
}


/** Resend proves mailbox control again. It never reveals receipts, IDs or tokens
 * to the caller and never associates a contract based on account email alone. */
export async function resendPaymentReceipts(stripe: Stripe, email: string): Promise<void> {
  if (!mailConfigured()) throw new HttpError(503, 'Le service email de rattachement doit être configuré.');
  const normalized = email.trim().toLowerCase();
  const receipts = await db.paymentReceipt.findMany({ where: { email: normalized, claimedAt: null }, orderBy: { createdAt: 'desc' }, take: 3 });
  for (const original of receipts) {
    const verified = await validatePaymentLinkSession(stripe, original.checkoutSessionId);
    if (verified.email !== normalized || !['active', 'trialing'].includes(verified.subscription.status)) continue;
    const renewed = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "PaymentReceipt" WHERE id=${original.id} FOR UPDATE`;
      const current = await tx.paymentReceipt.findUniqueOrThrow({ where: { id: original.id } });
      if (current.claimedAt || current.email !== normalized) return null;
      const raw = token();
      return tx.paymentReceipt.update({ where: { id: current.id }, data: { tokenHash: hashToken(raw), tokenEnvelope: encryptCredentials({ token: raw }), expiresAt: new Date(Date.now() + RECEIPT_LIFETIME_MS), emailedAt: null } });
    });
    if (renewed) await emailPaymentReceipt(renewed);
  }
}
