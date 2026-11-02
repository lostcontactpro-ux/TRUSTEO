import { z } from 'zod';
import { hash } from 'bcryptjs';
import { db } from '@/lib/db';
import { createSession, publicUser } from '@/lib/auth';
import { apiError, passwordSchema, guardMutation, jsonBody, rateLimit } from '@/lib/security';

const schema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254).transform((s) => s.toLowerCase()),
  password: passwordSchema,
  consent: z.literal(true),
}).strict();

export async function POST(request: Request) {
  try {
    guardMutation(request);
    await rateLimit('signup:global', 100, 3600);
    const input = schema.parse(await jsonBody(request));
    await rateLimit(`signup:${input.email}`, 5, 3600);
    const passwordHash = await hash(input.password, 12);
    const user = await db.user.create({ data: { email: input.email, firstName: input.firstName, lastName: input.lastName, passwordHash, consentAt: new Date(), subscription: { create: {} } } });
    await createSession(user.id);
    return Response.json({ user: publicUser(user) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
