import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { stripeClient } from '@/lib/billing';
import { apiError, guardMutation, HttpError, jsonBody, rateLimit } from '@/lib/security';

export const runtime = 'nodejs';
const input = z.object({ confirm: z.literal(true) }).strict();

/** Stop renewal in Stripe; retain access until the already agreed end date. */
export async function POST(request: Request) {
  try {
    guardMutation(request);
    const user = await requireUser();
    await rateLimit(`cancel-subscription:${user.id}`, 10, 60);
    input.parse(await jsonBody(request));
    const local = await db.subscription.findUnique({ where: { userId: user.id } });
    if (!local?.stripeSubscriptionId || !local.stripeCustomerId) {
      throw new HttpError(409, 'Aucun abonnement Stripe associé à votre compte.');
    }
    const stripe = stripeClient();
    const current = await stripe.subscriptions.retrieve(local.stripeSubscriptionId);
    const customerId = typeof current.customer === 'string' ? current.customer : current.customer.id;
    if (customerId !== local.stripeCustomerId) {
      throw new HttpError(409, 'La facturation doit être vérifiée avant de modifier cet abonnement.');
    }
    const ended = ['canceled', 'incomplete_expired'].includes(current.status);
    // Setting a boolean is repeatable. Stripe's SDK retries transport errors with
    // its own idempotency key; an old fixed key must not replay a cancellation
    // after a customer has resumed their subscription in the portal.
    const canceled = ended || current.cancel_at_period_end ? current : await stripe.subscriptions.update(current.id, { cancel_at_period_end: true });
    if (!ended && !canceled.cancel_at_period_end) throw new HttpError(502, 'Stripe n’a pas confirmé l’arrêt du renouvellement.');
    const periodEnd = canceled.items.data[0]?.current_period_end;
    const currentPeriodEnd = periodEnd ? new Date(periodEnd * 1000) : null;
    const saved = await db.subscription.updateMany({
      where: { id: local.id, userId: user.id, stripeSubscriptionId: current.id, stripeCustomerId: customerId },
      data: { cancelAtPeriodEnd: canceled.cancel_at_period_end },
    });
    if (saved.count !== 1) throw new HttpError(409, 'Votre abonnement a changé. Rechargez vos paramètres pour vérifier la confirmation Stripe.');
    return Response.json({
      cancelAtPeriodEnd: canceled.cancel_at_period_end,
      currentPeriodEnd: currentPeriodEnd?.toISOString() ?? null,
      trialEndsAt: canceled.trial_end ? new Date(canceled.trial_end * 1000).toISOString() : null,
      status: canceled.status,
    });
  } catch (error) { return apiError(error); }
}
