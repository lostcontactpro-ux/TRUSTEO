import { afterEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { introductoryCoupon, priceId, stripeClient, stripePlanFromPrice } from './billing';

vi.mock('./security', () => ({ HttpError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));
afterEach(() => vi.unstubAllEnvs());
describe('Stripe billing configuration', () => {
  it('fails closed without Stripe secret or mapped prices', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    vi.stubEnv('STRIPE_PRICE_ESSENTIAL_MONTH', '');
    expect(() => stripeClient()).toThrow('configuré');
    expect(() => priceId('essential', 'month')).toThrow('configuré');
    expect(stripePlanFromPrice('price_unrecognized')).toBeNull();
  });
  it('maps only server-controlled price IDs', () => {
    vi.stubEnv('STRIPE_PRICE_PRO_YEAR', 'price_pro_annual');
    expect(priceId('pro', 'year')).toBe('price_pro_annual');
    expect(stripePlanFromPrice('price_pro_annual')).toEqual({ plan: 'pro', interval: 'year' });
  });
  it('rejects a configured coupon with incorrect discount duration', async () => {
    vi.stubEnv('STRIPE_INTRO_COUPON_ID', 'coupon_invalid');
    const stripe = { coupons: { retrieve: vi.fn().mockResolvedValue({ id: 'coupon_invalid', valid: true, percent_off: 20, duration: 'forever' }) } } as unknown as Stripe;
    await expect(introductoryCoupon(stripe)).rejects.toThrow('2 mois');
  });
  it('creates the intro coupon only after verified resource_missing response', async () => {
    vi.stubEnv('STRIPE_INTRO_COUPON_ID', '');
    const retrieve = vi.fn().mockRejectedValue(new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', message: 'No such coupon', code: 'resource_missing' }));
    const create = vi.fn().mockResolvedValue({ id: 'trusteo_intro_20_2_months_v1' });
    const stripe = { coupons: { retrieve, create } } as unknown as Stripe;
    expect(await introductoryCoupon(stripe)).toBe('trusteo_intro_20_2_months_v1');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ percent_off: 20, duration: 'repeating', duration_in_months: 2 }), { idempotencyKey: 'trusteo_intro_20_2_months_v1' });
  });
  it('does not mask Stripe authorization failures as a missing coupon', async () => {
    vi.stubEnv('STRIPE_INTRO_COUPON_ID', '');
    const create = vi.fn();
    const stripe = { coupons: { retrieve: vi.fn().mockRejectedValue(new Error('Unauthorized')), create } } as unknown as Stripe;
    await expect(introductoryCoupon(stripe)).rejects.toThrow('Unauthorized');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('welcome discount application', () => {
  it('never touches a paid active contract or restarts a marked trial discount', async () => {
    const { ensureIntroductoryDiscount } = await import('./billing');
    const update = vi.fn(); const stripe = { subscriptions: { update } } as unknown as Stripe;
    await ensureIntroductoryDiscount(stripe, { status: 'active' } as Stripe.Subscription);
    await ensureIntroductoryDiscount(stripe, { status: 'trialing', metadata: { trusteo_intro_applied: 'v1' } } as unknown as Stripe.Subscription);
    expect(update).not.toHaveBeenCalled();
  });
  it('marks an already present coupon without replacing its original discount duration', async () => {
    const { ensureIntroductoryDiscount } = await import('./billing');
    const update = vi.fn().mockResolvedValue({});
    const stripe = { coupons: { retrieve: vi.fn().mockResolvedValue({ id: 'trusteo_intro_20_2_months_v1', valid: true, percent_off: 20, duration: 'repeating', duration_in_months: 2 }) }, subscriptions: { update } } as unknown as Stripe;
    await ensureIntroductoryDiscount(stripe, { id: 'sub_present', status: 'trialing', metadata: {}, discounts: [{ id: 'di_existing', source: { coupon: 'trusteo_intro_20_2_months_v1' } }] } as unknown as Stripe.Subscription);
    expect(update).toHaveBeenCalledWith('sub_present', { metadata: { trusteo_intro_applied: 'v1' } }, { idempotencyKey: 'trusteo-intro-marker-sub_present' });
  });
  it('adds the welcome coupon with an idempotency key while retaining other discount IDs', async () => {
    const { ensureIntroductoryDiscount } = await import('./billing');
    const update = vi.fn().mockResolvedValue({});
    const stripe = { coupons: { retrieve: vi.fn().mockResolvedValue({ id: 'trusteo_intro_20_2_months_v1', valid: true, percent_off: 20, duration: 'repeating', duration_in_months: 2 }) }, subscriptions: { update } } as unknown as Stripe;
    await ensureIntroductoryDiscount(stripe, { id: 'sub_new', status: 'trialing', metadata: {}, discounts: [{ id: 'di_other', source: { coupon: 'other_coupon' } }] } as unknown as Stripe.Subscription);
    expect(update).toHaveBeenCalledWith('sub_new', { metadata: { trusteo_intro_applied: 'v1' }, discounts: [{ discount: 'di_other' }, { coupon: 'trusteo_intro_20_2_months_v1' }] }, { idempotencyKey: 'trusteo-intro-apply-sub_new' });
  });
});
