import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type Stripe from 'stripe';
import { paymentLinks } from '@trusteo/core/pricing';
import { decryptCredentials } from '@trusteo/core/crypto';
const f = vi.hoisted(() => ({ receipt: null as any, subscription: null as any, email: 'owner@example.test', events: [] as any[], txTail: Promise.resolve(), send: vi.fn(), mailConfigured: vi.fn() }));
vi.mock('./mail', () => ({ sendMail: f.send, mailConfigured: f.mailConfigured, escapeHtml: (value: string) => value }));
vi.mock('./trial-eligibility', () => ({ claimMonthlyTrial: vi.fn().mockResolvedValue({ allowed: true, reason: 'claimed' }) }));
vi.mock('./db', () => {
  const find = ({ where }: any) => f.receipt && Object.entries(where).every(([key, value]) => f.receipt[key] === value) ? f.receipt : null;
  const database: any = {
    user: { findUniqueOrThrow: vi.fn(async () => ({ id: 'owner', email: f.email })) },
    paymentReceipt: {
      findUnique: vi.fn(async (input: any) => find(input)),
      findUniqueOrThrow: vi.fn(async (input: any) => { const result = find(input); if (!result) throw new Error('Missing receipt'); return result; }),
      findMany: vi.fn(async ({ where }: any) => f.receipt && f.receipt.email === where.email && !f.receipt.claimedAt ? [f.receipt] : []),
      create: vi.fn(async ({ data }: any) => {
        if (f.receipt) throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '6.19.3' });
        f.receipt = { id: 'receipt', emailedAt: null, claimedAt: null, claimedUserId: null, createdAt: new Date(), ...data }; return f.receipt;
      }),
      update: vi.fn(async ({ data }: any) => { Object.assign(f.receipt, data); return { ...f.receipt }; }),
      updateMany: vi.fn(async ({ where, data }: any) => { if (!find({ where })) return { count: 0 }; Object.assign(f.receipt, data); return { count: 1 }; }),
    },
    subscription: { findUnique: vi.fn(async () => f.subscription), updateMany: vi.fn(async ({ data }: any) => { Object.assign(f.subscription, data); return { count: 1 }; }), upsert: vi.fn(async ({ create, update }: any) => { f.subscription = f.subscription ? { ...f.subscription, ...update } : create; return f.subscription; }) },
    deferredStripeEvent: { findMany: vi.fn(async () => f.events), updateMany: vi.fn(async () => ({ count: 1 })) },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  database.$transaction = vi.fn(async (callback: any) => {
    let release!: () => void;
    const previous = f.txTail; f.txTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await callback(database); } finally { release(); }
  });
  return { db: database };
});
import { db } from './db';
import { claimPaymentReceipt, emailPaymentReceipt, resendPaymentReceipts, retainPaymentReceipt, validatePaymentLinkSession } from './payment-receipts';
function stripeFixture() {
  const price = { id: 'price_annual', currency: 'eur', unit_amount: 40900, recurring: { interval: 'year', interval_count: 1 }, billing_scheme: 'per_unit' };
  const subscription = { id: 'stripe_subscription', customer: 'stripe_customer', status: 'active', items: { data: [{ price, quantity: 1, current_period_end: Math.floor(Date.now() / 1000) + 365 * 86400 }], has_more: false }, trial_start: null, trial_end: null, cancel_at_period_end: false };
  const session = { id: 'checkout', customer: 'stripe_customer', subscription: 'stripe_subscription', mode: 'subscription', status: 'complete', payment_status: 'paid', payment_link: 'plink_allowed', customer_details: { email: 'Owner@Example.test' }, client_reference_id: 'attacker', metadata: { userId: 'attacker' } };
  return { subscription, session, stripe: { checkout: { sessions: { retrieve: vi.fn().mockResolvedValue(session) } }, subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription), cancel: vi.fn().mockResolvedValue({ status: 'canceled' }) }, paymentLinks: { retrieve: vi.fn().mockResolvedValue({ id: 'plink_allowed', url: paymentLinks.essential.year }), listLineItems: vi.fn().mockResolvedValue({ data: [{ price, quantity: 1 }], has_more: false }) } } as unknown as Stripe };
}
beforeEach(() => {
  vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', 'ab'.repeat(32)); vi.stubEnv('APP_URL', 'https://app.unit-fixture.fr');
  vi.stubEnv('STRIPE_PRICE_ESSENTIAL_YEAR', 'price_annual');
  f.receipt = null; f.email = 'owner@example.test'; f.events = []; f.txTail = Promise.resolve();
  f.subscription = { id: 'local_subscription', userId: 'owner', status: 'incomplete', stripeSubscriptionId: null, checkoutSessionId: null, trialUsed: false, stripeEventCreated: 0, updatedAt: new Date(0) };
  f.send.mockReset(); f.send.mockResolvedValue(undefined); f.mailConfigured.mockReset(); f.mailConfigured.mockReturnValue(true);
  vi.mocked(db.subscription.upsert).mockClear();
});
afterEach(() => vi.unstubAllEnvs());
function receiptToken() { return decryptCredentials<{ token: string }>(f.receipt.tokenEnvelope).token; }
describe('anonymous Payment Link receipts', () => {
  it('validates the actual allowed Payment Link and ignores caller-provided owner metadata', async () => {
    const { stripe } = stripeFixture(); const verified = await validatePaymentLinkSession(stripe, 'checkout');
    expect(verified.selection).toEqual({ plan: 'essential', interval: 'year' }); expect(verified.email).toBe('owner@example.test');
    expect(db.subscription.upsert).not.toHaveBeenCalled();
  });
  it('refuses an arbitrary Payment Link before creating a receipt or granting rights', async () => {
    const { stripe } = stripeFixture(); vi.mocked(stripe.paymentLinks.retrieve).mockResolvedValue({ url: 'https://buy.stripe.com/unknown' } as any);
    await expect(retainPaymentReceipt(stripe, 'checkout')).rejects.toMatchObject({ status: 409 });
    expect(f.receipt).toBeNull(); expect(db.subscription.upsert).not.toHaveBeenCalled();
  });
  it('persists a receipt before mail, and keeps the identical recoverable token across a failed send and webhook retry', async () => {
    const { stripe } = stripeFixture(); const receipt = await retainPaymentReceipt(stripe, 'checkout'); const raw = receiptToken();
    expect(receipt.tokenHash).not.toBe(raw); expect(receipt.tokenEnvelope).not.toContain(raw);
    f.send.mockRejectedValueOnce(new Error('mail unavailable'));
    await expect(emailPaymentReceipt(receipt)).rejects.toThrow('mail unavailable');
    expect(f.receipt.emailedAt).toBeNull();
    const retried = await retainPaymentReceipt(stripe, 'checkout'); expect(receiptToken()).toBe(raw);
    await emailPaymentReceipt(retried); expect(f.receipt.emailedAt).toBeInstanceOf(Date);
    expect(f.send.mock.calls[1][0].to).toBe('owner@example.test');
    expect(f.send.mock.calls[1][0].text).toContain(`/signup?paymentToken=${raw}`);
    expect(db.subscription.upsert).not.toHaveBeenCalled();
  });
  it('fails explicitly when Resend is absent without losing pending receipt evidence', async () => {
    const { stripe } = stripeFixture(); const receipt = await retainPaymentReceipt(stripe, 'checkout'); f.mailConfigured.mockReturnValue(false);
    await expect(emailPaymentReceipt(receipt)).rejects.toMatchObject({ status: 503 });
    expect(f.receipt.checkoutSessionId).toBe('checkout'); expect(f.receipt.claimedAt).toBeNull();
  });
  it('requires both an emailed secret and the matching authenticated account before association', async () => {
    const { stripe } = stripeFixture(); await retainPaymentReceipt(stripe, 'checkout');
    await expect(claimPaymentReceipt(stripe, 'owner', 'f'.repeat(64))).rejects.toMatchObject({ status: 409 });
    f.email = 'attacker@example.test';
    await expect(claimPaymentReceipt(stripe, 'owner', receiptToken())).rejects.toMatchObject({ status: 403 });
    expect(db.subscription.upsert).not.toHaveBeenCalled(); expect(f.receipt.claimedAt).toBeNull();
  });
  it('claims once, consumes encrypted proof and preserves the latest event watermark', async () => {
    const { stripe } = stripeFixture(); await retainPaymentReceipt(stripe, 'checkout'); const raw = receiptToken();
    f.subscription.stripeEventCreated = 123; f.events = [{ eventCreated: 130, receivedAt: new Date(0) }];
    expect(await claimPaymentReceipt(stripe, 'owner', raw)).toEqual({ claimed: true, plan: 'essential', interval: 'year', status: 'active' });
    expect(f.subscription.stripeCustomerId).toBe('stripe_customer'); expect(f.subscription.userId).toBe('owner');
    expect(f.subscription.stripeEventCreated).toBe(130); expect(f.receipt.tokenEnvelope).toBeNull(); expect(f.receipt.claimedUserId).toBe('owner');
    await expect(claimPaymentReceipt(stripe, 'owner', raw)).rejects.toMatchObject({ status: 409 });
  });
  it('allows only one concurrent claim under the receipt row lock', async () => {
    const { stripe } = stripeFixture(); await retainPaymentReceipt(stripe, 'checkout'); const raw = receiptToken();
    const results = await Promise.allSettled([claimPaymentReceipt(stripe, 'owner', raw), claimPaymentReceipt(stripe, 'owner', raw)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(db.subscription.upsert).toHaveBeenCalledTimes(1);
  });
  it('refuses a stale preflight if a cancellation or pending event changed during verification', async () => {
    const { stripe } = stripeFixture(); await retainPaymentReceipt(stripe, 'checkout');
    f.subscription.status = 'canceled'; f.subscription.updatedAt = new Date(Date.now() + 60_000);
    await expect(claimPaymentReceipt(stripe, 'owner', receiptToken())).rejects.toMatchObject({ status: 409 });
    expect(db.subscription.upsert).not.toHaveBeenCalled(); expect(f.receipt.claimedAt).toBeNull();
  });
  it('never activates an annual trial even with a genuine stored receipt', async () => {
    const { stripe, subscription } = stripeFixture(); subscription.status = 'trialing';
    await retainPaymentReceipt(stripe, 'checkout');
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('stripe_subscription', { invoice_now: false, prorate: false });
    await expect(claimPaymentReceipt(stripe, 'owner', receiptToken())).rejects.toMatchObject({ status: 409 });
    expect(db.subscription.upsert).not.toHaveBeenCalled();
  });
  it('renews an expired receipt only by emailing a newly rotated proof to its original email', async () => {
    const { stripe } = stripeFixture(); await retainPaymentReceipt(stripe, 'checkout'); const old = receiptToken(); f.receipt.expiresAt = new Date(0);
    await resendPaymentReceipts(stripe, 'owner@example.test');
    const renewed = receiptToken(); expect(renewed).not.toBe(old); expect(f.receipt.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(f.send.mock.calls[0][0].to).toBe('owner@example.test'); expect(f.send.mock.calls[0][0].text).toContain(renewed);
    await expect(claimPaymentReceipt(stripe, 'owner', old)).rejects.toMatchObject({ status: 409 });
  });
  it('remembers a canceled trial proof without granting rights, enabling a paid retry from settings', async () => {
    const { stripe, subscription } = stripeFixture(); await retainPaymentReceipt(stripe, 'checkout');
    Object.assign(subscription, { status: 'canceled', trial_start: 100 });
    await expect(claimPaymentReceipt(stripe, 'owner', receiptToken())).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Paramètres') });
    expect(f.subscription.trialUsed).toBe(true); expect(db.subscription.upsert).not.toHaveBeenCalled(); expect(f.receipt.claimedAt).toBeNull();
  });
  it('does not disclose another payer or send anything for an unrelated account email', async () => {
    const { stripe } = stripeFixture(); await retainPaymentReceipt(stripe, 'checkout');
    await expect(resendPaymentReceipts(stripe, 'unrelated@example.test')).resolves.toBeUndefined();
    expect(f.send).not.toHaveBeenCalled(); expect(f.receipt.claimedAt).toBeNull();
  });
});
