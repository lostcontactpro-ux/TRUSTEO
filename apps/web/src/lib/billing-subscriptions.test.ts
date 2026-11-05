import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
const fixtures = vi.hoisted(() => ({ claim: vi.fn(), discount: vi.fn() }));
vi.mock('./trial-eligibility', () => ({ claimMonthlyTrial: fixtures.claim }));
vi.mock('./billing', () => ({ ensureIntroductoryDiscount: fixtures.discount }));
vi.mock('./security', () => ({ HttpError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));
import { subscriptionEntitlementData } from './billing-subscriptions';
function remote(status = 'trialing') {
  return { id: 'sub_trial', customer: 'cus_trial', status, default_payment_method: { id: 'pm_card', card: { fingerprint: 'card_fingerprint' } }, trial_start: 100, trial_end: 200, cancel_at_period_end: true,
    items: { data: [{ current_period_end: 300 }] } } as unknown as Stripe.Subscription;
}
function client() {
  return { customers: { retrieve: vi.fn().mockResolvedValue({ id: 'cus_trial', email: 'holder@example.test', invoice_settings: {} }) }, subscriptions: { cancel: vi.fn().mockResolvedValue({}) }, paymentMethods: { retrieve: vi.fn(), list: vi.fn().mockResolvedValue({ data: [], has_more: false }) } };
}
beforeEach(() => { fixtures.claim.mockReset(); fixtures.discount.mockReset(); fixtures.discount.mockResolvedValue(undefined); });
describe('Stripe subscription entitlement policy', () => {
  it('blocks externally configured annual trial access without giving local trial dates', async () => {
    const stripe = client();
    const result = await subscriptionEntitlementData(stripe as unknown as Stripe, remote(), { plan: 'essential', interval: 'year' });
    expect(result.status).toBe('blocked_annual_trial'); expect(result.trialEndsAt).toBeNull();
    expect(fixtures.claim).not.toHaveBeenCalled(); expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_trial', { invoice_now: false, prorate: false });
  });
  it('records a first monthly trial before rights and applies welcome coupon', async () => {
    fixtures.claim.mockResolvedValue({ allowed: true, reason: 'claimed' });
    const result = await subscriptionEntitlementData(client() as unknown as Stripe, remote(), { plan: 'pro', interval: 'month' });
    expect(result.status).toBe('trialing'); expect(result.cancelAtPeriodEnd).toBe(true);
    expect(fixtures.claim).toHaveBeenCalledWith({ stripeSubscriptionId: 'sub_trial', email: 'holder@example.test', cardFingerprint: 'card_fingerprint', interval: 'month', hasTrial: true });
    expect(fixtures.discount).toHaveBeenCalledTimes(1);
  });
  it('cancels a new repeated trial without an invoice, never granting rights', async () => {
    fixtures.claim.mockResolvedValue({ allowed: false, reason: 'identity_used' });
    const stripe = client();
    const result = await subscriptionEntitlementData(stripe as unknown as Stripe, remote(), { plan: 'essential', interval: 'month' });
    expect(result.status).toBe('trial_rejected'); expect(result.trialEndsAt).toBeNull();
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_trial', { invoice_now: false, prorate: false });
    expect(fixtures.discount).not.toHaveBeenCalled();
  });
  it.each(['identity_mismatch', 'unverifiable_card'])('retries %s without canceling a legitimate existing trial', async reason => {
    fixtures.claim.mockResolvedValue({ allowed: false, reason });
    const stripe = client();
    await expect(subscriptionEntitlementData(stripe as unknown as Stripe, remote(), { plan: 'essential', interval: 'month' })).rejects.toMatchObject({ status: 503 });
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled(); expect(fixtures.discount).not.toHaveBeenCalled();
  });
  it('cancels a persistently unverifiable trial before an automatic charge can occur', async () => {
    fixtures.claim.mockResolvedValue({ allowed: false, reason: 'unverifiable_card' });
    const stripe = client(); const subscription = remote(); subscription.created = Math.floor(Date.now() / 1000) - 3600;
    const result = await subscriptionEntitlementData(stripe as unknown as Stripe, subscription, { plan: 'essential', interval: 'month' });
    expect(result.status).toBe('trial_unverifiable');
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_trial', { invoice_now: false, prorate: false });
  });
  it('does not reject or modify an already paid contract because it once had a trial', async () => {
    const stripe = client();
    const result = await subscriptionEntitlementData(stripe as unknown as Stripe, remote('active'), { plan: 'essential', interval: 'year' });
    expect(result.status).toBe('active'); expect(result.trialEndsAt).toBeNull();
    expect(fixtures.claim).not.toHaveBeenCalled(); expect(fixtures.discount).not.toHaveBeenCalled(); expect(stripe.customers.retrieve).not.toHaveBeenCalled();
  });
});
