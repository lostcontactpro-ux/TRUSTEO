import type Stripe from 'stripe';
import { claimMonthlyTrial } from './trial-eligibility';
import { HttpError } from './security';
import { ensureIntroductoryDiscount } from './billing';
import type { PaymentSelection } from './payment-link-validation';

export function stripeId(value: string | { id: string } | null | undefined): string | null {
  return typeof value === 'string' ? value : value?.id ?? null;
}

async function trialIdentity(stripe: Stripe, subscription: Stripe.Subscription, fallbackEmail?: string) {
  const customerId = stripeId(subscription.customer);
  if (!customerId) throw new HttpError(503, 'La vérification du titulaire du paiement est indisponible.');
  const customer = await stripe.customers.retrieve(customerId, { expand: ['invoice_settings.default_payment_method'] });
  if (customer.deleted) throw new HttpError(409, 'Le compte de facturation a été supprimé.');
  const email = (fallbackEmail || customer.email || '').trim().toLowerCase();
  let method = subscription.default_payment_method || customer.invoice_settings.default_payment_method;
  if (typeof method === 'string') method = await stripe.paymentMethods.retrieve(method);
  if (!method) {
    const cards = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 2 });
    if (!cards.has_more && cards.data.length === 1) method = cards.data[0];
  }
  const cardFingerprint = typeof method === 'object' ? method?.card?.fingerprint ?? undefined : undefined;
  return { email, cardFingerprint };
}

/** Validated Stripe state determines access, never a client plan or customer email alone. */
export async function subscriptionEntitlementData(stripe: Stripe, subscription: Stripe.Subscription, selection: PaymentSelection, fallbackEmail?: string) {
  let status: string = subscription.status;
  if (selection.interval === 'year' && status === 'trialing') {
    await stripe.subscriptions.cancel(subscription.id, { invoice_now: false, prorate: false });
    status = 'blocked_annual_trial';
  }
  if (selection.interval === 'month' && subscription.status === 'trialing') {
    const identity = await trialIdentity(stripe, subscription, fallbackEmail);
    const result = await claimMonthlyTrial({ stripeSubscriptionId: subscription.id, interval: selection.interval, hasTrial: true, ...identity });
    if (!result.allowed) {
      if (result.reason === 'identity_mismatch') throw new HttpError(503, 'L’identité de cet essai doit être rapprochée avant toute modification de ses droits.');
      if (result.reason === 'unverifiable_card') {
        // Allow initial payment-method attachment to settle. A persistently
        // unverifiable trial is canceled before it can produce an automatic bill.
        if (!subscription.created || Date.now() - subscription.created * 1000 < 15 * 60_000) throw new HttpError(503, 'La carte doit être confirmée par Stripe avant l’activation de l’essai.');
        await stripe.subscriptions.cancel(subscription.id, { invoice_now: false, prorate: false });
        status = 'trial_unverifiable';
      } else {
      // Reject repeat trials without allowing a later automatic charge for an
      // unusable trial. This is never used for an already paid active contract.
      await stripe.subscriptions.cancel(subscription.id, { invoice_now: false, prorate: false });
      status = 'trial_rejected';
      }
    } else {
      await ensureIntroductoryDiscount(stripe, subscription);
    }
  }
  const item = subscription.items.data[0];
  return {
    ...selection, status, stripeSubscriptionId: subscription.id,
    currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
    trialEndsAt: status === 'trialing' && subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
    trialUsed: !!subscription.trial_start,
    cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
  };
}
