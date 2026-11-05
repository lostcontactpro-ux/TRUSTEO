import type Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { stripeClient } from '@/lib/billing';
import { processStripeEvent } from '@/lib/billing-webhooks';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: 'Stripe webhook non configuré.' }, { status: 503 });
  const signature = request.headers.get('stripe-signature');
  if (!signature) return Response.json({ error: 'Signature manquante.' }, { status: 400 });
  let stripe: ReturnType<typeof stripeClient>;
  try { stripe = stripeClient(); } catch { return Response.json({ error: 'Stripe webhook non configuré.' }, { status: 503 }); }
  let event: Stripe.Event;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body) > 1_000_000) return Response.json({ error: 'Requête trop volumineuse.' }, { status: 413 });
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch { return Response.json({ error: 'Signature invalide.' }, { status: 400 }); }
  try { return Response.json(await processStripeEvent(stripe, event)); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && await db.webhookEvent.findUnique({ where: { id: event.id } })) return Response.json({ received: true, duplicate: true });
    console.error('Stripe webhook processing failed', { eventId: event.id, type: event.type });
    return Response.json({ error: 'Traitement temporairement indisponible. Le paiement reste en attente de traitement.' }, { status: 500 });
  }
}
