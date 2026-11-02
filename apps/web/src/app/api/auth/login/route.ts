import { z } from 'zod';
import { compare, hashSync } from 'bcryptjs';
import { db } from '@/lib/db';
import { createSession, publicUser } from '@/lib/auth';
import { apiError, guardMutation, HttpError, jsonBody, rateLimit } from '@/lib/security';

const schema = z.object({ email: z.string().trim().email().max(254).transform((s) => s.toLowerCase()), password: z.string().min(1).max(72) }).strict();
const dummyHash = hashSync('not-a-user-password-for-timing-protection', 12);
export async function POST(request: Request) {
  try {
    guardMutation(request);
    await rateLimit('login:global', 1000, 3600);
    const input = schema.parse(await jsonBody(request));
    await rateLimit(`login:${input.email}`, 10, 900);
    const user = await db.user.findUnique({ where: { email: input.email } });
    const matches = await compare(input.password, user?.passwordHash ?? dummyHash);
    if (!user || !matches) throw new HttpError(401, 'Email ou mot de passe incorrect.');
    await createSession(user.id);
    return Response.json({ user: publicUser(user) });
  } catch (error) { return apiError(error); }
}
