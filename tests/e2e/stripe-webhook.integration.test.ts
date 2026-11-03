/** Real Stripe signature verification, mocked outbound Stripe transport and persistence.
 * This test grants no live entitlement and performs no network request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
const fixture = vi.hoisted(() => ({
  records: new Map<string, unknown>(),
  subscription: { id: 'local_sub', userId: 'fixture_user', stripeCustomerId: 'cus_fixture', stripeSubscriptionId: null as string | null, status: 'incomplete', stripeEventCreated: 0, trialUsed: false },
  update: vi.fn(), updateMany: vi.fn(), retrieve: vi.fn(),
}));
vi.mock('@prisma/client', () => ({ Prisma: {
  TransactionIsolationLevel: { Serializable: 'Serializable' },
  PrismaClientKnownRequestError: class extends Error { code = 'P2002'; },
} }));
vi.mock('@/lib/db', () => {
  const tx = {
    webhookEvent: { create: vi.fn(async ({ data }) => { fixture.records.set(data.id, data); return data; }) },
    subscription: {
      findUnique: vi.fn(async () => fixture.subscription),
      findUniqueOrThrow: vi.fn(async () => fixture.subscription),
      updateMany: fixture.updateMany.mockResolvedValue({ count: 1 }),
      update: fixture.update.mockImplementation(async ({ data }) => { Object.assign(fixture.subscription, data); return fixture.subscription; }),
    },
  };
  return { db: { ...tx, webhookEvent: { findUnique: vi.fn(async ({ where }) => fixture.records.get(where.id) || null) }, $transaction: vi.fn(async (callback) => {
    // Roll back the test double when the route aborts its transaction.
    const before = new Map(fixture.records);
    try { return await callback(tx); } catch (error) { fixture.records = before; throw error; }
  }) } };
});
vi.mock('@/lib/billing', () => {
  const stripe = new Stripe('sk_test_fixture_only');
  stripe.subscriptions.retrieve = fixture.retrieve;
  return { stripeClient: () => stripe, stripePlanFromPrice: (id: string) => id === 'price_essential_fixture' ? { plan: 'essential', interval: 'month' } : null };
});
import { POST } from '../../apps/web/src/app/api/billing/webhook/route';
const webhookSecret = 'whsec_fixture_only_not_a_real_credential';
const now = Math.floor(Date.now() / 1000);
function remoteSubscription(overrides: Record<string, unknown> = {}) {
  return { id: 'sub_fixture', object: 'subscription', customer: 'cus_fixture', status: 'trialing', trial_start: now, trial_end: now + 14 * 86400, items: { data: [{ price: { id: 'price_essential_fixture' }, current_period_end: now + 14 * 86400 }] }, ...overrides };
}
function signedRequest(id: string, created = now, timestamp = now, type = 'customer.subscription.created', object = remoteSubscription()) {
  const payload = JSON.stringify({ id, object: 'event', type, created, data: { object } });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret, timestamp });
  return new Request('http://localhost/api/billing/webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': signature } });
}
beforeEach(() => {
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', webhookSecret);
  fixture.records.clear(); fixture.update.mockClear(); fixture.updateMany.mockClear(); fixture.retrieve.mockReset();
  Object.assign(fixture.subscription, { stripeSubscriptionId: null, status: 'incomplete', stripeEventCreated: 0, trialUsed: false });
  fixture.retrieve.mockResolvedValue(remoteSubscription());
});
afterEach(() => vi.unstubAllEnvs());
describe('signed Stripe subscription webhook handler', () => {
  it('validates an actual Stripe signature, persists a trial and deduplicates delivery', async () => {
    expect((await POST(signedRequest('evt_fixture_trial'))).status).toBe(200);
    expect(fixture.update).toHaveBeenCalledTimes(1);
    expect(fixture.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'trialing', plan: 'essential', trialUsed: true, stripeSubscriptionId: 'sub_fixture' }) }));
    expect(fixture.records.has('evt_fixture_trial')).toBe(true);
    expect((await POST(signedRequest('evt_fixture_trial'))).status).toBe(200);
    expect(fixture.update).toHaveBeenCalledTimes(1);
    expect(fixture.retrieve).toHaveBeenCalledTimes(1);
  });
  it('rejects missing, invalid and expired signatures before reading or writing data', async () => {
    const missing = await POST(new Request('http://localhost/api/billing/webhook', { method: 'POST', body: '{}' }));
    expect(missing.status).toBe(400);
    const invalid = await POST(new Request('http://localhost/api/billing/webhook', { method: 'POST', body: '{}', headers: { 'stripe-signature': 'bad-signature' } }));
    expect(invalid.status).toBe(400);
    expect((await POST(signedRequest('evt_expired', now, now - 600))).status).toBe(400);
    expect(fixture.retrieve).not.toHaveBeenCalled(); expect(fixture.update).not.toHaveBeenCalled();
  });
  it('fails closed for unknown prices and returns a retryable error', async () => {
    fixture.retrieve.mockResolvedValue(remoteSubscription({ items: { data: [{ price: { id: 'price_unrecognized' }, current_period_end: now + 86400 }] } }));
    expect((await POST(signedRequest('evt_unknown_price'))).status).toBe(500);
    expect(fixture.update).not.toHaveBeenCalled(); expect(fixture.records.has('evt_unknown_price')).toBe(false);
  });
  it('does not overwrite a later subscription event with an older delivery', async () => {
    fixture.subscription.stripeEventCreated = now + 20;
    expect((await POST(signedRequest('evt_old', now))).status).toBe(200);
    expect(fixture.update).not.toHaveBeenCalled();
  });
  it('clears only the matching expired Checkout after a signed expiration event', async () => {
    const response = await POST(signedRequest('evt_checkout_expired', now, now, 'checkout.session.expired', { id: 'cs_fixture_expired', customer: 'cus_fixture', status: 'expired' } as ReturnType<typeof remoteSubscription>));
    expect(response.status).toBe(200);
    expect(fixture.updateMany).toHaveBeenCalledWith({ where: { stripeCustomerId: 'cus_fixture', checkoutSessionId: 'cs_fixture_expired' }, data: { checkoutSessionId: null, checkoutExpiresAt: null } });
    expect(fixture.retrieve).not.toHaveBeenCalled();
  });
  it('fails closed when signing configuration is absent', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    expect((await POST(signedRequest('evt_no_secret'))).status).toBe(503);
    expect(fixture.update).not.toHaveBeenCalled();
  });
});
