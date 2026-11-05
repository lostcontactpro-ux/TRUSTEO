import type Stripe from 'stripe';
import { z } from 'zod';
import { amountFor, paymentLinks } from '@trusteo/core/pricing';
import { HttpError } from './security';

const selectionSchema = z.object({ plan: z.enum(['essential', 'pro']), interval: z.enum(['month', 'year']) }).strict();
export type PaymentSelection = z.infer<typeof selectionSchema>;
const selections: PaymentSelection[] = [
  { plan: 'essential', interval: 'month' }, { plan: 'essential', interval: 'year' },
  { plan: 'pro', interval: 'month' }, { plan: 'pro', interval: 'year' },
];
const invalidPriceMessage = 'Le tarif Stripe ne correspond pas à une formule Trusteo autorisée. Le paiement doit être vérifié.';

/** Only the URL returned by Stripe for the signed session's Payment Link is
 * trusted. Caller parameters, metadata and client_reference_id grant no plan. */
export function selectionFromPaymentLinkUrl(url: string): PaymentSelection | null {
  const selected = selections.find(({ plan, interval }) => paymentLinks[plan][interval] === url);
  return selected ? { ...selected } : null;
}

function configuredPriceId({ plan, interval }: PaymentSelection): string | undefined {
  return process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`] || undefined;
}

/** No expected selection: require a unique server-configured Price ID.
 * An expected selection must come from an allowed Payment Link retrieved from
 * Stripe, never from a browser or payment metadata. The caller must separately
 * verify that the Payment Link line item's price matches this subscription. */
export function validateSubscriptionPrice(subscription: Stripe.Subscription, expected?: PaymentSelection): PaymentSelection {
  const items = subscription?.items;
  if (!items || items.has_more || items.data.length !== 1) throw new HttpError(409, invalidPriceMessage);
  const item = items.data[0];
  const price = item.price;
  if (item.quantity !== 1 || !price || typeof price.id !== 'string' || !price.id) throw new HttpError(409, invalidPriceMessage);

  let selected: PaymentSelection;
  if (expected) {
    const parsed = selectionSchema.safeParse(expected);
    if (!parsed.success) throw new HttpError(409, invalidPriceMessage);
    selected = parsed.data;
    const configured = configuredPriceId(selected);
    if (configured && configured !== price.id) throw new HttpError(409, invalidPriceMessage);
  } else {
    const matches = selections.filter(selection => configuredPriceId(selection) === price.id);
    // Duplicate configured price IDs are ambiguous and fail closed.
    if (matches.length !== 1) throw new HttpError(409, invalidPriceMessage);
    selected = matches[0];
  }

  const amount = amountFor(selected.plan, selected.interval);
  if (price.currency !== 'eur' || price.unit_amount !== amount ||
      (price.unit_amount_decimal != null && Number(price.unit_amount_decimal) !== amount) ||
      !price.recurring || price.recurring.interval !== selected.interval || price.recurring.interval_count !== 1 ||
      (price.recurring.usage_type != null && price.recurring.usage_type !== 'licensed') ||
      (price.billing_scheme != null && price.billing_scheme !== 'per_unit')) {
    throw new HttpError(409, invalidPriceMessage);
  }
  return { ...selected };
}

/** Historic trials on now-paid annual subscriptions are not trial access. */
export function assertNoAnnualTrial(subscription: Stripe.Subscription, selection: PaymentSelection): void {
  if (selection.interval === 'year' && subscription.status === 'trialing') {
    throw new HttpError(409, 'Les abonnements annuels ne proposent pas d’essai. Le paiement annuel doit être confirmé avant de donner accès à Trusteo.');
  }
}

/** The paid Checkout's customer_details is authoritative for delivery only.
 * Ownership still requires the separately emailed token and a matching account. */
export function paymentEmail(session: Stripe.Checkout.Session): string {
  const email = z.string().trim().max(254).email().safeParse(session?.customer_details?.email);
  if (!email.success) throw new HttpError(409, 'Le paiement ne contient pas d’adresse email valide pour son rattachement.');
  return email.data.toLowerCase();
}
