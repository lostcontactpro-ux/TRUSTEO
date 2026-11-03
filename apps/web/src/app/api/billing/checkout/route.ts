import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, guardMutation, HttpError, rateLimit, jsonBody } from '@/lib/security';
import { appUrl, introductoryCoupon, priceId, stripeClient } from '@/lib/billing';
import { amountFor, pricing } from '@trusteo/core/pricing';
const input = z.object({ plan: z.enum(['essential', 'pro']), interval: z.enum(['month', 'year']) });

export async function POST(request: Request) {
  try {
    guardMutation(request);
    const user = await requireUser();
    await rateLimit(`checkout:${user.id}`, 6, 60);
    const { plan, interval } = input.parse(await jsonBody(request));
    const stripe = stripeClient();
    const configuredPriceId = priceId(plan, interval);
    const price = await stripe.prices.retrieve(configuredPriceId);
    if (!price.active || price.currency !== 'eur' || price.unit_amount !== amountFor(plan, interval) || price.recurring?.interval !== interval || price.recurring.interval_count !== 1) {
      throw new HttpError(503, 'Le tarif Stripe ne correspond pas aux tarifs Trusteo.');
    }
    let subscription = await db.subscription.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
    if ((subscription.stripeSubscriptionId && !['canceled', 'incomplete_expired'].includes(subscription.status)) || ['active', 'trialing', 'past_due', 'unpaid', 'paused'].includes(subscription.status)) throw new HttpError(409, 'Gérez votre abonnement existant depuis le portail client.');
    if (subscription.checkoutSessionId) {
      if (subscription.checkoutSessionId.startsWith('pending:')) {
        if (!subscription.checkoutExpiresAt || subscription.checkoutExpiresAt > new Date()) throw new HttpError(409, 'Une page de paiement est déjà en cours de création. Réessayez dans quelques minutes.');
      } else {
        // The local expiry alone cannot establish that Checkout was unpaid: it
        // may have completed before expiry while its webhook is still delayed.
        const existing = await stripe.checkout.sessions.retrieve(subscription.checkoutSessionId);
        if (existing.status === 'open' && existing.url) return Response.json({ url: existing.url });
        if (existing.status === 'complete') throw new HttpError(409, 'Paiement reçu. La confirmation de votre abonnement est en cours.');
        if (existing.status !== 'expired') throw new HttpError(503, 'L’état du paiement doit être confirmé par Stripe.');
        await db.subscription.updateMany({ where: { id: subscription.id, checkoutSessionId: existing.id }, data: { checkoutSessionId: null, checkoutExpiresAt: null } });
      }
    }
    let customerId = subscription.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, name: `${user.firstName} ${user.lastName}`, metadata: { userId: user.id } }, { idempotencyKey: `trusteo-customer-${user.id}` });
      customerId = customer.id;
      subscription = await db.subscription.update({ where: { userId: user.id }, data: { stripeCustomerId: customerId } });
    }
    const reservation = `pending:${randomUUID()}`;
    const reserved = await db.subscription.updateMany({ where: { id: subscription.id, OR: [{ checkoutExpiresAt: null }, { checkoutExpiresAt: { lte: new Date() } }] }, data: { checkoutSessionId: reservation, checkoutExpiresAt: new Date(Date.now() + 15 * 60_000) } });
    if (reserved.count !== 1) throw new HttpError(409, 'Une page de paiement est déjà ouverte ou en cours de création.');
    try {
    const history = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
    if (history.has_more || history.data.some(item => !['canceled', 'incomplete_expired'].includes(item.status))) {
      throw new HttpError(409, 'Un abonnement Stripe existe déjà ou nécessite une vérification. Utilisez le portail client plutôt qu’un nouveau paiement.');
    }
    const trial = !subscription.trialUsed && history.data.length === 0;
    const coupon = trial && interval === 'month' ? await introductoryCoupon(stripe) : undefined;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription', customer: customerId, client_reference_id: user.id,
      payment_method_collection: 'always', payment_method_types: ['card'],
      line_items: [{ price: configuredPriceId, quantity: 1 }],
      subscription_data: {
        metadata: { userId: user.id, plan, interval },
        ...(trial ? { trial_period_days: pricing.trialDays, trial_settings: { end_behavior: { missing_payment_method: 'cancel' as const } } } : {}),
      },
      ...(coupon ? { discounts: [{ coupon }] } : {}),
      success_url: `${appUrl()}/app/settings?checkout=success`, cancel_url: `${appUrl()}/signup?step=3`,
      metadata: { userId: user.id, plan, interval },
    }, { idempotencyKey: `trusteo-checkout-${user.id}-${plan}-${interval}-${Math.floor(Date.now() / 3_600_000)}` });
    const saved = await db.subscription.updateMany({ where: { id: subscription.id, checkoutSessionId: reservation }, data: { checkoutSessionId: session.id, checkoutExpiresAt: new Date(session.expires_at * 1000) } });
    if (saved.count !== 1) {
      // Never return an untracked live payment URL after a lost reservation.
      if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
      throw new HttpError(409, 'Cette demande de paiement a expiré. Réessayez.');
    }
    if (!session.url) throw new HttpError(502, 'Stripe n’a pas fourni de page de paiement.');
    return Response.json({ url: session.url });
    } catch (error) {
      await db.subscription.updateMany({ where: { id: subscription.id, checkoutSessionId: reservation }, data: { checkoutSessionId: null, checkoutExpiresAt: null } });
      throw error;
    }
  } catch (error) { return apiError(error); }
}
