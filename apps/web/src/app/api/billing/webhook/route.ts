import Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { stripeClient, stripePlanFromPrice } from '@/lib/billing';
export const runtime = 'nodejs';

async function applySubscription(event: Stripe.Event, subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
  const local = await db.subscription.findUnique({ where: { stripeCustomerId: customerId } });
  if (!local) throw new Error('Unknown Stripe customer');
  const item = subscription.items.data[0];
  const mapped = item && stripePlanFromPrice(item.price.id);
  // Never grant a plan for an arbitrary unrecognized Stripe price.
  if (!mapped && !['canceled', 'incomplete_expired'].includes(subscription.status)) throw new Error('Unknown Stripe price');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await db.$transaction(async tx => {
        await tx.webhookEvent.create({ data: { id: event.id, provider: 'stripe', type: event.type } });
        const current = await tx.subscription.findUniqueOrThrow({ where: { id: local.id } });
        if (current.stripeEventCreated > event.created) return;
        if (current.stripeSubscriptionId && current.stripeSubscriptionId !== subscription.id && ['active', 'trialing'].includes(current.status)) {
          // A delayed deletion of a previous subscription must not cancel its replacement.
          if (['canceled', 'incomplete_expired'].includes(subscription.status)) return;
          // A second live subscription is a billing error, never an automatic overwrite.
          throw new Error('Multiple subscriptions require billing reconciliation');
        }
        await tx.subscription.update({ where: { id: local.id }, data: {
          ...(mapped || {}), status: subscription.status,
          stripeSubscriptionId: subscription.id, stripeEventCreated: event.created,
          currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
          trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
          trialUsed: current.trialUsed || !!subscription.trial_start,
          checkoutSessionId: null, checkoutExpiresAt: null,
        } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        if (await db.webhookEvent.findUnique({ where: { id: event.id } })) return;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) continue;
      throw error;
    }
  }
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: 'Stripe webhook non configuré.' }, { status: 503 });
  const signature = request.headers.get('stripe-signature');
  if (!signature) return Response.json({ error: 'Signature manquante.' }, { status: 400 });
  let event: Stripe.Event;
  let stripe: Stripe;
  try {
    stripe = stripeClient();
    const body = await request.text();
    if (Buffer.byteLength(body) > 1_000_000) return Response.json({ error: 'Requête trop volumineuse.' }, { status: 413 });
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch {
    return Response.json({ error: 'Signature invalide.' }, { status: 400 });
  }
  try {
    if (await db.webhookEvent.findUnique({ where: { id: event.id } })) return Response.json({ received: true, duplicate: true });
    if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
      const received = event.data.object as Stripe.Subscription;
      // Fetch Stripe's current state rather than trust a stale delivery payload.
      const current = await stripe.subscriptions.retrieve(received.id);
      await applySubscription(event, current);
    } else if (event.type === 'checkout.session.expired') {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
      if (customerId) {
        await db.$transaction(async tx => {
          await tx.webhookEvent.create({ data: { id: event.id, provider: 'stripe', type: event.type } });
          await tx.subscription.updateMany({ where: { stripeCustomerId: customerId, checkoutSessionId: session.id }, data: { checkoutSessionId: null, checkoutExpiresAt: null } });
        });
      }
    } else if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === 'subscription' && session.subscription) {
        const current = await stripe.subscriptions.retrieve(typeof session.subscription === 'string' ? session.subscription : session.subscription.id);
        await applySubscription(event, current);
      }
    }
    return Response.json({ received: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && await db.webhookEvent.findUnique({ where: { id: event.id } })) {
      return Response.json({ received: true, duplicate: true });
    }
    // Let Stripe retry; never acknowledge failed entitlement persistence.
    console.error('Stripe webhook processing failed', { eventId: event.id, type: event.type });
    return Response.json({ error: 'Traitement temporairement indisponible.' }, { status: 500 });
  }
}
