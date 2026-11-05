import { z } from 'zod';
import { compare } from 'bcryptjs';
import { db } from '@/lib/db';
import { destroySession, publicUser, requireUser } from '@/lib/auth';
import { apiError, guardMutation, HttpError, jsonBody, rateLimit } from '@/lib/security';
const schema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().email().max(254).transform((s) => s.toLowerCase()).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  notifyEmail: z.boolean().optional(),
  notifyPush: z.boolean().optional(),
  currentPassword: z.string().min(1).max(72).optional(),
}).strict();
export async function GET() {
  try {
    const user = await requireUser();
    const subscription = user.subscription;
    return Response.json({ user: publicUser(user), subscription: subscription ? {
      plan: subscription.plan, interval: subscription.interval, status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd, trialEndsAt: subscription.trialEndsAt,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    } : null });
  }
  catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try {
    guardMutation(request); const user = await requireUser(); await rateLimit(`account:${user.id}`, 30, 3600);
    const { currentPassword, ...data } = schema.parse(await jsonBody(request));
    if (data.email && data.email !== user.email && (!currentPassword || !await compare(currentPassword, user.passwordHash))) throw new HttpError(401, 'Votre mot de passe actuel est requis pour changer votre email.');
    const updated = await db.user.update({ where: { id: user.id }, data });
    return Response.json({ user: publicUser(updated) });
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request) {
  try {
    guardMutation(request); const user = await requireUser(); await rateLimit(`account-delete:${user.id}`, 5, 3600);
    const input = z.object({ password: z.string().min(1).max(72), confirmation: z.literal('SUPPRIMER') }).strict().parse(await jsonBody(request));
    if (!await compare(input.password, user.passwordHash)) throw new HttpError(401, 'Mot de passe incorrect.');
    await db.$transaction(async tx => {
      // A stale session snapshot must not allow deletion while Checkout is opened.
      // Checkout's reservation update locks this same Subscription row. If deletion
      // wins, its later reservation cannot succeed; if Checkout wins, reject here.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Subscription" WHERE "userId"=${user.id} FOR UPDATE`;
      const subscription = await tx.subscription.findUnique({ where: { userId: user.id } });
      const expiredReservation = subscription?.checkoutSessionId?.startsWith('pending:') && subscription.checkoutExpiresAt && subscription.checkoutExpiresAt <= new Date();
      if (subscription?.checkoutSessionId && !expiredReservation) {
        throw new HttpError(409, 'Une page de paiement est encore associée à votre compte. Attendez sa confirmation ou son expiration avant de supprimer le compte.');
      }
      if (subscription?.stripeSubscriptionId && !['canceled', 'incomplete_expired'].includes(subscription.status)) {
        throw new HttpError(409, 'Annulez votre abonnement dans le portail de facturation avant de supprimer le compte, afin d’arrêter les prélèvements.');
      }
      // Payment references are retained for billing reconciliation, while the
      // deleted account's clear email and claim envelope are removed. The
      // independent, pseudonymized trial registry must survive re-registration.
      await tx.paymentReceipt.updateMany({ where: { claimedUserId: user.id }, data: {
        email: '', claimedUserId: null, tokenEnvelope: null,
      } });
      await tx.user.delete({ where: { id: user.id } });
    });
    // Cascading deletion already revoked every session. Clear the browser cookie
    // only after successful deletion; a billing conflict leaves the user signed in.
    await destroySession();
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
