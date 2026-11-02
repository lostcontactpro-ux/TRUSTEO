import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z, ZodError } from 'zod';
import { db } from './db';
import { appUrl } from './env';

export const passwordSchema = z.string().min(12, 'Utilisez au moins 12 caractères.').max(72).refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Le mot de passe doit contenir au maximum 72 octets.');

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function guardMutation(request: Request): void {
  // Browser JSON mutations require exact origin. Cookie authentication is never
  // accepted from cross-origin forms; signed webhooks use separate routes.
  const origin = request.headers.get('origin');
  if (origin !== appUrl()) throw new HttpError(403, 'Origine de la requête refusée.');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site') throw new HttpError(403, 'Requête intersite refusée.');
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Un corps JSON est requis.');
  }
}

export function token(): string { return randomBytes(32).toString('hex'); }
export function hashToken(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Shared PostgreSQL counter: atomic across web instances, never trusts proxy IP
// headers as authentication. A global endpoint bucket supplements email buckets.
export async function rateLimit(key: string, limit = 20, windowSec = 60): Promise<void> {
  const rows = await db.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "RateLimit" ("key", "count", "resetAt")
    VALUES (${hashToken(key)}, 1, NOW() + ${windowSec} * INTERVAL '1 second')
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."resetAt" <= NOW() THEN 1 ELSE "RateLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimit"."resetAt" <= NOW() THEN NOW() + ${windowSec} * INTERVAL '1 second' ELSE "RateLimit"."resetAt" END
    RETURNING "count"
  `;
  if ((rows[0]?.count ?? limit + 1) > limit) throw new HttpError(429, 'Trop de demandes. Réessayez plus tard.');
}

export async function jsonBody(request: Request): Promise<unknown> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 1_000_000) throw new HttpError(413, 'Requête trop volumineuse.');
  const text = await request.text();
  if (Buffer.byteLength(text) > 1_000_000) throw new HttpError(413, 'Requête trop volumineuse.');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'JSON invalide.'); }
}

export function apiError(error: unknown): Response {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError) return Response.json({ error: 'Vérifiez les champs saisis.', fields: error.flatten().fieldErrors }, { status: 400 });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return Response.json({ error: 'Cette ressource existe déjà.' }, { status: 409 });
  }
  console.error('API request failed', error instanceof Error ? error.name : 'unknown');
  return Response.json({ error: 'Service temporairement indisponible.' }, { status: 503 });
}
