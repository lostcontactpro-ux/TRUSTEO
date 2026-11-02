import { z } from 'zod';
import { compare, hash } from 'bcryptjs';
import { db } from '@/lib/db';
import { createSession, requireUser } from '@/lib/auth';
import { apiError, passwordSchema, guardMutation, HttpError, jsonBody, rateLimit } from '@/lib/security';
export async function POST(request: Request) {
  try {
    guardMutation(request); const user = await requireUser(); await rateLimit(`password:${user.id}`, 5, 3600);
    const input = z.object({ currentPassword: z.string().min(1).max(72), password: passwordSchema }).strict().parse(await jsonBody(request));
    if (!await compare(input.currentPassword, user.passwordHash)) throw new HttpError(401, 'Mot de passe actuel incorrect.');
    const passwordHash = await hash(input.password, 12);
    await db.$transaction([db.user.update({ where: { id: user.id }, data: { passwordHash } }), db.session.deleteMany({ where: { userId: user.id } })]);
    await createSession(user.id);
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
