import { z } from 'zod';
import { hash } from 'bcryptjs';
import { db } from '@/lib/db';
import { apiError, passwordSchema, guardMutation, hashToken, HttpError, jsonBody, rateLimit } from '@/lib/security';
const schema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: passwordSchema }).strict();
export async function POST(request: Request) {
  try {
    guardMutation(request);
    await rateLimit('password-reset-submit:global', 100, 3600);
    const input = schema.parse(await jsonBody(request));
    const passwordHash = await hash(input.password, 12);
    await db.$transaction(async (tx) => {
      const reset = await tx.passwordReset.findUnique({ where: { tokenHash: hashToken(input.token) } });
      if (!reset || reset.expiresAt <= new Date()) throw new HttpError(400, 'Lien expiré ou déjà utilisé.');
      const claimed = await tx.passwordReset.deleteMany({ where: { id: reset.id, expiresAt: { gt: new Date() } } });
      if (!claimed.count) throw new HttpError(400, 'Lien expiré ou déjà utilisé.');
      await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId: reset.userId } });
    });
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
