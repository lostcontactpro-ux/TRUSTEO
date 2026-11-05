import Stripe from 'stripe';
import { pricing, type BillingInterval } from '@trusteo/core/pricing';
import { HttpError } from './security';

export function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new HttpError(503, 'Stripe n’est pas encore configuré.');
  return new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 });
}

export function appUrl(): string {
  const url = new URL(process.env.APP_URL || 'http://localhost:3000');
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new HttpError(503, 'APP_URL doit utiliser HTTPS en production.');
  return url.origin;
}

export function priceId(plan: 'essential' | 'pro', interval: BillingInterval): string {
  const key = `STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`;
  const id = process.env[key];
  if (!id) throw new HttpError(503, `Le tarif Stripe ${plan}/${interval} n’est pas configuré.`);
  return id;
}

export async function introductoryCoupon(stripe: Stripe): Promise<string> {
  if (process.env.STRIPE_INTRO_COUPON_ID) {
    const coupon = await stripe.coupons.retrieve(process.env.STRIPE_INTRO_COUPON_ID);
    if (!coupon.valid || coupon.percent_off !== pricing.introductoryDiscount.percent || coupon.duration !== 'repeating' || coupon.duration_in_months !== pricing.introductoryDiscount.months) {
      throw new HttpError(503, 'Le coupon d’introduction Stripe doit accorder 20 % pendant 2 mois.');
    }
    return coupon.id;
  }
  // A stable coupon ID + Stripe idempotency prevents duplicate coupons across workers.
  const id = 'trusteo_intro_20_2_months_v1';
  try {
    const coupon = await stripe.coupons.retrieve(id);
    if (!coupon.valid || coupon.percent_off !== 20 || coupon.duration !== 'repeating' || coupon.duration_in_months !== 2) throw new HttpError(503, 'Coupon d’introduction Stripe invalide.');
    return coupon.id;
  } catch (error) {
    if (!(error instanceof Stripe.errors.StripeInvalidRequestError) || error.code !== 'resource_missing') throw error;
    const coupon = await stripe.coupons.create({ id, name: 'Trusteo — bienvenue', percent_off: 20, duration: 'repeating', duration_in_months: 2 }, { idempotencyKey: id });
    return coupon.id;
  }
}

export function stripePlanFromPrice(id: string): { plan: 'essential' | 'pro'; interval: BillingInterval } | null {
  for (const plan of ['essential', 'pro'] as const) {
    for (const interval of ['month', 'year'] as const) {
      if (process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`] === id) return { plan, interval };
    }
  }
  return null;
}

/** Apply the welcome discount only while the first eligible trial is running.
 * Keep existing discount IDs to preserve their original expiry, and persist a
 * Stripe-side marker so later deliveries never restart the two-month window. */
export async function ensureIntroductoryDiscount(stripe: Stripe, subscription: Stripe.Subscription): Promise<void> {
  if (subscription.status !== 'trialing' || subscription.metadata?.trusteo_intro_applied === 'v1') return;
  const expanded = subscription.discounts?.some(discount => typeof discount === 'string')
    ? await stripe.subscriptions.retrieve(subscription.id, { expand: ['discounts'] })
    : subscription;
  if (expanded.status !== 'trialing' || expanded.metadata?.trusteo_intro_applied === 'v1') return;
  const coupon = await introductoryCoupon(stripe);
  const discounts = expanded.discounts || [];
  const present = discounts.some(discount => typeof discount === 'object' && (typeof discount.source.coupon === 'string' ? discount.source.coupon : discount.source.coupon?.id) === coupon);
  const metadata = { ...expanded.metadata, trusteo_intro_applied: 'v1' };
  if (present) {
    await stripe.subscriptions.update(subscription.id, { metadata }, { idempotencyKey: `trusteo-intro-marker-${subscription.id}` });
  } else {
    await stripe.subscriptions.update(subscription.id, { metadata, discounts: [...discounts.map(discount => ({ discount: typeof discount === 'string' ? discount : discount.id })), { coupon }] }, { idempotencyKey: `trusteo-intro-apply-${subscription.id}` });
  }
}
