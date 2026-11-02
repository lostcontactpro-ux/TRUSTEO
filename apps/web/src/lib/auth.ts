import { cookies } from 'next/headers';
import { db } from './db';
import { hashToken, HttpError, token } from './security';

export const SESSION_COOKIE = 'trusteo_session';
const SESSION_DAYS = 30;

export async function createSession(userId: string): Promise<void> {
  const raw = token();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.session.create({ data: { tokenHash: hashToken(raw), userId, expiresAt: expires } });
  (await cookies()).set(SESSION_COOKIE, raw, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', expires });
}

export async function currentUser() {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
  const session = await db.session.findUnique({ where: { tokenHash: hashToken(raw) }, include: { user: { include: { subscription: true } } } });
  if (!session || session.expiresAt <= new Date()) return null;
  return session.user;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new HttpError(401, 'Connectez-vous pour continuer.');
  return user;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (raw) await db.session.deleteMany({ where: { tokenHash: hashToken(raw) } });
  jar.delete(SESSION_COOKIE);
}

export function publicUser(user: { id: string; email: string; firstName: string; lastName: string; phone: string | null; notifyEmail: boolean; notifyPush: boolean }) {
  return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, phone: user.phone, notifyEmail: user.notifyEmail, notifyPush: user.notifyPush };
}
