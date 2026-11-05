/** Real Stripe HMAC verification and subscription policy; mocked outbound Stripe,
 * email delivery and database adapters. No live payment or mail is performed. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
const f = vi.hoisted(() => ({
  records: new Map<string, unknown>(), deferred: new Map<string, unknown>(), localKnown: true, configured: true,
  subscription: { id: 'local_sub', userId: 'fixture_user', stripeCustomerId: 'cus_fixture', stripeSubscriptionId: null as string | null, status: 'incomplete', stripeEventCreated: 0, trialUsed: false, updatedAt: new Date(0) },
  update: vi.fn(), updateMany: vi.fn(), retrieve: vi.fn(), checkout: vi.fn(), cancel: vi.fn(), retain: vi.fn(), email: vi.fn(),
}));
vi.mock('@prisma/client', () => ({ Prisma: { TransactionIsolationLevel: { Serializable: 'Serializable' }, PrismaClientKnownRequestError: class extends Error { code = 'P2002'; } } }));
vi.mock('@/lib/trial-eligibility', () => ({ claimMonthlyTrial: vi.fn().mockResolvedValue({ allowed: true, reason: 'claimed' }) }));
vi.mock('@/lib/payment-receipts', () => ({ retainPaymentReceipt: f.retain, emailPaymentReceipt: f.email, expectedPaymentSelection: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/db', () => {
  const tx = {
    webhookEvent: {
      create: vi.fn(async ({ data }) => { f.records.set(data.id, data); return data; }),
      upsert: vi.fn(async ({ create }) => { f.records.set(create.id, create); return create; }),
      findUnique: vi.fn(async ({ where }) => f.records.get(where.id) || null),
    },
    deferredStripeEvent: {
      upsert: vi.fn(async ({ create }) => { f.deferred.set(create.id, create); return create; }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    subscription: {
      findUnique: vi.fn(async () => f.localKnown ? f.subscription : null),
      findUniqueOrThrow: vi.fn(async () => f.subscription),
      updateMany: f.updateMany.mockResolvedValue({ count: 1 }),
      update: f.update.mockImplementation(async ({ data }) => { Object.assign(f.subscription, data); return f.subscription; }),
    },
  };
  return { db: { ...tx, $transaction: vi.fn(async callback => {
    const before = new Map(f.records);
    try { return await callback(tx); } catch (error) { f.records = before; throw error; }
  }) } };
});
vi.mock('@/lib/billing', () => {
  const stripe = new Stripe('sk_test_fixture_only');
  stripe.subscriptions.retrieve = f.retrieve; stripe.subscriptions.cancel = f.cancel;
  stripe.checkout.sessions.retrieve = f.checkout;
  stripe.customers.retrieve = vi.fn().mockResolvedValue({ id: 'cus_fixture', email: 'fixture@example.test', invoice_settings: {} });
  return { stripeClient: () => { if (!f.configured) throw new Error('not configured'); return stripe; }, ensureIntroductoryDiscount: vi.fn().mockResolvedValue(undefined) };
});
import { POST } from '../../apps/web/src/app/api/billing/webhook/route';
const webhookSecret = 'whsec_fixture_only_not_a_real_credential';
const now = Math.floor(Date.now() / 1000);
function remoteSubscription(overrides: Record<string, unknown> = {}) {
  return { id: 'sub_fixture', object: 'subscription', customer: 'cus_fixture', status: 'trialing', trial_start: now, trial_end: now + 14 * 86400, cancel_at_period_end: true,
    default_payment_method: { id: 'pm_fixture', card: { fingerprint: 'fixture_card' } },
    items: { data: [{ quantity: 1, price: { id: 'price_essential_fixture', unit_amount: 4980, currency: 'eur', recurring: { interval: 'month', interval_count: 1 } }, current_period_end: now + 14 * 86400 }], has_more: false }, ...overrides };
}
function signedRequest(id: string, created = now, timestamp = now, type = 'customer.subscription.created', object: any = remoteSubscription()) {
  const payload = JSON.stringify({ id, object: 'event', type, created, data: { object } });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret, timestamp });
  return new Request('http://localhost/api/billing/webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': signature } });
}
beforeEach(() => {
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', webhookSecret); vi.stubEnv('STRIPE_PRICE_ESSENTIAL_MONTH', 'price_essential_fixture'); vi.stubEnv('STRIPE_PRICE_ESSENTIAL_YEAR', 'price_annual_fixture');
  f.records.clear(); f.deferred.clear(); f.localKnown = true; f.configured = true;
  f.update.mockClear(); f.updateMany.mockClear(); f.retrieve.mockReset(); f.checkout.mockReset(); f.cancel.mockReset(); f.retain.mockReset(); f.email.mockReset();
  f.cancel.mockResolvedValue({ status: 'canceled' }); f.retain.mockResolvedValue({ id: 'durable_receipt', claimedAt: null }); f.email.mockResolvedValue(undefined);
  Object.assign(f.subscription, { stripeSubscriptionId: null, status: 'incomplete', stripeEventCreated: 0, trialUsed: false, updatedAt: new Date(0) });
  f.retrieve.mockResolvedValue(remoteSubscription());
  f.checkout.mockResolvedValue({ id: 'cs_paymentlink', mode: 'subscription', status: 'complete', payment_status: 'paid', subscription: 'sub_fixture', customer: 'cus_fixture', payment_link: 'plink_fixture' });
});
afterEach(() => vi.unstubAllEnvs());
describe('signed Stripe webhook transport and policy', () => {
  it('verifies an actual signature, persists an eligible monthly trial and deduplicates delivery', async () => {
    expect((await POST(signedRequest('evt_trial'))).status).toBe(200);
    expect(f.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'trialing', plan: 'essential', trialUsed: true, stripeSubscriptionId: 'sub_fixture', cancelAtPeriodEnd: true }) }));
    expect((await POST(signedRequest('evt_trial'))).status).toBe(200);
    expect(f.update).toHaveBeenCalledTimes(1); expect(f.retrieve).toHaveBeenCalledTimes(1);
  });
  it('rejects missing, invalid and expired signatures before any Stripe retrieval or writes', async () => {
    expect((await POST(new Request('http://localhost/api/billing/webhook', { method: 'POST', body: '{}' }))).status).toBe(400);
    expect((await POST(new Request('http://localhost/api/billing/webhook', { method: 'POST', body: '{}', headers: { 'stripe-signature': 'bad' } }))).status).toBe(400);
    expect((await POST(signedRequest('evt_expired', now, now - 600))).status).toBe(400);
    expect(f.retrieve).not.toHaveBeenCalled(); expect(f.update).not.toHaveBeenCalled();
  });
  it('fails closed for unknown prices on a known account', async () => {
    f.retrieve.mockResolvedValue(remoteSubscription({ items: { data: [{ quantity: 1, price: { id: 'price_unrecognized' } }] } }));
    expect((await POST(signedRequest('evt_price'))).status).toBe(500);
    expect(f.update).not.toHaveBeenCalled(); expect(f.records.has('evt_price')).toBe(false);
  });
  it('retains a subscription event received before Checkout without associating by metadata or email', async () => {
    f.localKnown = false;
    const response = await POST(signedRequest('evt_before_checkout'));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ pending: true });
    expect(f.deferred.get('evt_before_checkout')).toMatchObject({ stripeSubscriptionId: 'sub_fixture', stripeCustomerId: 'cus_fixture' });
    expect(f.update).not.toHaveBeenCalled(); expect(f.records.has('evt_before_checkout')).toBe(false);
  });
  it('does not overwrite a later event or same-second cancellation that arrived during retrieval', async () => {
    f.subscription.stripeEventCreated = now + 20;
    expect((await POST(signedRequest('evt_old'))).status).toBe(200); expect(f.update).not.toHaveBeenCalled();
    f.subscription.stripeEventCreated = now;
    f.retrieve.mockImplementation(async () => { f.subscription.status = 'canceled'; f.subscription.updatedAt = new Date(Date.now() + 1000); return remoteSubscription({ status: 'active' }); });
    expect((await POST(signedRequest('evt_stale_snapshot'))).status).toBe(500); expect(f.update).not.toHaveBeenCalled();
  });
  it('cancels an externally misconfigured annual trial without invoice and blocks rights', async () => {
    f.retrieve.mockResolvedValue(remoteSubscription({ items: { data: [{ quantity: 1, price: { id: 'price_annual_fixture', unit_amount: 40900, currency: 'eur', recurring: { interval: 'year', interval_count: 1 } }, current_period_end: now + 86400 }], has_more: false } }));
    expect((await POST(signedRequest('evt_annual_trial'))).status).toBe(200);
    expect(f.cancel).toHaveBeenCalledWith('sub_fixture', { invoice_now: false, prorate: false });
    expect(f.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'blocked_annual_trial', trialEndsAt: null }) }));
  });
  it('keeps receipt processing retryable when Resend fails rather than acknowledging a lost activation email', async () => {
    f.email.mockRejectedValue(new Error('Resend unavailable'));
    const response = await POST(signedRequest('evt_paid', now, now, 'checkout.session.completed', { id: 'cs_paymentlink' }));
    expect(response.status).toBe(500); expect(f.retain).toHaveBeenCalledWith(expect.anything(), 'cs_paymentlink');
    expect(f.records.has('evt_paid')).toBe(false); expect(f.update).not.toHaveBeenCalled();
    f.email.mockResolvedValue(undefined);
    expect((await POST(signedRequest('evt_paid', now, now, 'checkout.session.completed', { id: 'cs_paymentlink' }))).status).toBe(200);
    expect(f.records.has('evt_paid')).toBe(true); expect(f.update).not.toHaveBeenCalled();
  });
  it('clears only the matching expired Checkout after a signed expiration event', async () => {
    expect((await POST(signedRequest('evt_checkout_expired', now, now, 'checkout.session.expired', { id: 'cs_expired', customer: 'cus_fixture', status: 'expired' }))).status).toBe(200);
    expect(f.updateMany).toHaveBeenCalledWith({ where: { stripeCustomerId: 'cus_fixture', checkoutSessionId: 'cs_expired' }, data: { checkoutSessionId: null, checkoutExpiresAt: null } });
  });
  it('responds with configured503 for absent signing or API credentials', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', ''); expect((await POST(signedRequest('evt_no_secret'))).status).toBe(503);
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', webhookSecret); f.configured = false;
    expect((await POST(signedRequest('evt_no_api_key'))).status).toBe(503);
  });
});
