import type Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import { db } from './db';
import { stripeId, subscriptionEntitlementData } from './billing-subscriptions';
import { emailPaymentReceipt, expectedPaymentSelection, retainPaymentReceipt } from './payment-receipts';
import { validateSubscriptionPrice } from './payment-link-validation';

async function deferEvent(event: Stripe.Event, subscription: Stripe.Subscription, checkoutSessionId?: string) {
  const stripeCustomerId = stripeId(subscription.customer);
  if (!stripeCustomerId) throw new Error('Stripe customer missing');
  await db.deferredStripeEvent.upsert({ where: { id: event.id }, create: { id: event.id, type: event.type, stripeSubscriptionId: subscription.id, stripeCustomerId, eventCreated: event.created, checkoutSessionId }, update: {} });
  return { received: true, pending: true };
}

async function applySubscription(stripe: Stripe, event: Stripe.Event, subscription: Stripe.Subscription, decisionStartedAt: Date) {
  const stripeCustomerId = stripeId(subscription.customer);
  if (!stripeCustomerId) throw new Error('Stripe customer missing');
  const local = await db.subscription.findUnique({ where: { stripeCustomerId } });
  // Payment Link subscriptions can arrive before Checkout and before a User exists.
  // Persist the event; never infer an owner from customer email or metadata.
  if (!local) return deferEvent(event, subscription);
  const expected = await expectedPaymentSelection(subscription.id);
  let selection;
  try { selection = validateSubscriptionPrice(subscription); }
  catch (error) {
    if (!expected) throw error;
    selection = validateSubscriptionPrice(subscription, expected);
  }
  const snapshot = await subscriptionEntitlementData(stripe, subscription, selection);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await db.$transaction(async tx => {
        await tx.webhookEvent.create({ data: { id: event.id, provider: 'stripe', type: event.type } });
        const current = await tx.subscription.findUniqueOrThrow({ where: { id: local.id } });
        if (current.stripeEventCreated > event.created) return;
        if (current.updatedAt > decisionStartedAt) throw new Error('Subscription changed during Stripe verification; retry');
        if (current.stripeSubscriptionId && current.stripeSubscriptionId !== subscription.id && !['canceled', 'incomplete_expired'].includes(current.status)) {
          if (['canceled', 'incomplete_expired'].includes(subscription.status)) return;
          throw new Error('Multiple subscriptions require billing reconciliation');
        }
        await tx.subscription.update({ where: { id: local.id }, data: { ...snapshot,
          stripeEventCreated: event.created, trialUsed: current.trialUsed || snapshot.trialUsed,
          checkoutSessionId: null, checkoutExpiresAt: null,
        } });
        await tx.deferredStripeEvent.updateMany({ where: { stripeSubscriptionId: subscription.id, resolvedAt: null }, data: { resolvedAt: new Date() } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { received: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && await db.webhookEvent.findUnique({ where: { id: event.id } })) return { received: true, duplicate: true };
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error('Subscription transaction did not complete');
}

export async function processStripeEvent(stripe: Stripe, event: Stripe.Event) {
  if (await db.webhookEvent.findUnique({ where: { id: event.id } })) return { received: true, duplicate: true };
  const verificationStartedAt = new Date();
  if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
    const current = await stripe.subscriptions.retrieve((event.data.object as Stripe.Subscription).id, { expand: ['default_payment_method'] });
    return applySubscription(stripe, event, current, verificationStartedAt);
  }
  if (event.type === 'checkout.session.expired') {
    const session = event.data.object as Stripe.Checkout.Session;
    const stripeCustomerId = stripeId(session.customer);
    await db.$transaction(async tx => {
      await tx.webhookEvent.create({ data: { id: event.id, provider: 'stripe', type: event.type } });
      if (stripeCustomerId) await tx.subscription.updateMany({ where: { stripeCustomerId, checkoutSessionId: session.id }, data: { checkoutSessionId: null, checkoutExpiresAt: null } });
    });
    return { received: true };
  }
  if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
    const session = await stripe.checkout.sessions.retrieve((event.data.object as Stripe.Checkout.Session).id);
    const subscriptionId = stripeId(session.subscription);
    if (session.mode !== 'subscription' || !subscriptionId) return { received: true, ignored: true };
    const current = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['default_payment_method'] });
    if (session.payment_status === 'unpaid') return deferEvent(event, current, session.id);
    if (session.payment_link) {
      const receipt = await retainPaymentReceipt(stripe, session.id);
      await emailPaymentReceipt(receipt); // Failure is retryable; durable receipt is retained.
      await db.webhookEvent.upsert({ where: { id: event.id }, create: { id: event.id, provider: 'stripe', type: event.type }, update: {} });
      return { received: true, pendingClaim: !receipt.claimedAt };
    }
    const customerId = stripeId(session.customer);
    const local = customerId ? await db.subscription.findUnique({ where: { stripeCustomerId: customerId } }) : null;
    if (!local || local.checkoutSessionId !== session.id && local.stripeSubscriptionId !== subscriptionId) return deferEvent(event, current, session.id);
    return applySubscription(stripe, event, current, verificationStartedAt);
  }
  return { received: true, ignored: true };
}
