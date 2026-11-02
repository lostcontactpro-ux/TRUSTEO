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
  try { const user = await requireUser(); return Response.json({ user: publicUser(user), subscription: user.subscription }); }
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
    if (user.subscription?.stripeSubscriptionId && !['canceled', 'incomplete_expired'].includes(user.subscription.status)) {
      throw new HttpError(409, 'Annulez votre abonnement dans le portail de facturation avant de supprimer le compte, afin d’arrêter les prélèvements.');
    }
    await destroySession();
    await db.user.delete({ where: { id: user.id } });
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
