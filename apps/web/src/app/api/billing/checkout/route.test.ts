import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ trial: vi.fn(), coupon: vi.fn(), create: vi.fn(), price: vi.fn(), subscription: null as any }));
vi.mock('@/lib/auth', () => ({ requireUser: vi.fn().mockResolvedValue({ id: 'owner', email: 'owner@example.test', firstName: 'Camille', lastName: 'Test' }) }));
vi.mock('@/lib/trial-eligibility', () => ({ canOfferMonthlyTrial: f.trial }));
vi.mock('@/lib/db', () => ({ db: { subscription: { upsert: vi.fn(async () => f.subscription), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } } }));
vi.mock('@/lib/billing', () => ({
  appUrl: () => 'http://localhost:3000', priceId: () => 'price_configured', introductoryCoupon: f.coupon,
  stripeClient: () => ({ prices: { retrieve: f.price }, subscriptions: { list: vi.fn().mockResolvedValue({ data: [], has_more: false }) }, checkout: { sessions: { create: f.create } } }),
}));
vi.mock('@/lib/security', async original => ({ ...await original<typeof import('@/lib/security')>(), rateLimit: vi.fn().mockResolvedValue(undefined) }));
import { POST } from './route';
beforeEach(() => {
  vi.stubEnv('APP_URL', 'http://localhost:3000'); f.trial.mockReset(); f.coupon.mockReset(); f.create.mockReset(); f.price.mockReset();
  f.trial.mockResolvedValue(true); f.coupon.mockResolvedValue('intro_coupon');
  f.subscription = { id: 'local', status: 'incomplete', stripeCustomerId: 'customer', stripeSubscriptionId: null, checkoutSessionId: null, trialUsed: false };
  f.create.mockResolvedValue({ id: 'checkout', url: 'https://checkout.stripe.com/fixture', status: 'open', expires_at: Math.floor(Date.now() / 1000) + 3600 });
});
afterEach(() => vi.unstubAllEnvs());
function request(interval: 'month' | 'year') {
  return new Request('http://localhost:3000/api/billing/checkout', { method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'essential', interval }) });
}
describe('server Checkout trial eligibility', () => {
  it('never attaches a trial or monthly coupon to an annual purchase', async () => {
    f.price.mockResolvedValue({ active: true, currency: 'eur', unit_amount: 40900, recurring: { interval: 'year', interval_count: 1 } });
    expect((await POST(request('year'))).status).toBe(200);
    const options = f.create.mock.calls[0][0];
    expect(options.subscription_data).not.toHaveProperty('trial_period_days'); expect(options).not.toHaveProperty('discounts');
    expect(f.trial).not.toHaveBeenCalled(); expect(f.coupon).not.toHaveBeenCalled();
  });
  it('grants an eligible monthly account a card-required fourteen-day trial', async () => {
    f.price.mockResolvedValue({ active: true, currency: 'eur', unit_amount: 4980, recurring: { interval: 'month', interval_count: 1 } });
    expect((await POST(request('month'))).status).toBe(200);
    expect(f.create.mock.calls[0][0]).toMatchObject({ payment_method_collection: 'always', payment_method_types: ['card'], subscription_data: { trial_period_days: 14 }, discounts: [{ coupon: 'intro_coupon' }] });
    expect(f.trial).toHaveBeenCalledWith({ email: 'owner@example.test' });
  });
  it.each(['trial_rejected', 'blocked_annual_trial', 'trial_unverifiable'])('allows a paid retry after Stripe canceled the %s trial', async status => {
    Object.assign(f.subscription, { status, stripeSubscriptionId: 'previous_canceled_trial', trialUsed: true });
    f.price.mockResolvedValue({ active: true, currency: 'eur', unit_amount: 4980, recurring: { interval: 'month', interval_count: 1 } });
    expect((await POST(request('month'))).status).toBe(200);
    expect(f.create.mock.calls[0][0].subscription_data).not.toHaveProperty('trial_period_days');
    expect(f.trial).not.toHaveBeenCalled();
  });
  it('does not recreate a trial when the durable identity ledger refuses it', async () => {
    f.trial.mockResolvedValue(false);
    f.price.mockResolvedValue({ active: true, currency: 'eur', unit_amount: 4980, recurring: { interval: 'month', interval_count: 1 } });
    expect((await POST(request('month'))).status).toBe(200);
    expect(f.create.mock.calls[0][0].subscription_data).not.toHaveProperty('trial_period_days');
    expect(f.coupon).not.toHaveBeenCalled();
  });
});
