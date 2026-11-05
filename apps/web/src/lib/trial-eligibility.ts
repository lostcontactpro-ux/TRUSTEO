import { createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from './db';
import { HttpError } from './security';

// Backend only. Callers obtain card fingerprints from verified Stripe objects,
// never from browser input, and never return registry hashes to a client.
const KEY_CONTEXT = 'trusteo:monthly-trial-identity:key:v1';
const HASH_CONTEXT = 'trusteo:monthly-trial-identity:v1';
const MAX_PURGE_BATCH = 500;
const emailInput = z.string().trim().toLowerCase().max(254).email();
export type TrialIdentity = 'email' | 'card';
export type TrialClaimInput = {
  stripeSubscriptionId: string;
  email: string;
  cardFingerprint?: string | null;
  interval: 'month' | 'year';
  /** True only for the current, verified Stripe subscription's actual trial. */
  hasTrial: boolean;
};
export type TrialClaimResult = {
  allowed: boolean;
  reason: 'claimed' | 'same_subscription' | 'identity_used' | 'identity_mismatch' | 'unverifiable_card' | 'not_applicable';
};

export function canonicalizeTrialEmail(email: string): string {
  const normalized = emailInput.parse(email);
  const separator = normalized.lastIndexOf('@');
  let local = normalized.slice(0, separator); const domain = normalized.slice(separator + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.split('+', 1)[0].replaceAll('.', '');
    if (!local) throw new HttpError(400, 'Adresse email invalide.');
    return `${local}@gmail.com`;
  }
  // Do not invent alias rules for Microsoft, business domains or other providers.
  return normalized;
}
function fingerprint(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  // Stripe fingerprints are opaque, case-sensitive identifiers, not card data.
  return /^[\x21-\x7e]{1,256}$/.test(normalized) ? normalized : null;
}
function identityKey(): Buffer {
  const value = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) throw new HttpError(503, 'La vérification des essais est temporairement indisponible.');
  return createHmac('sha256', Buffer.from(value, 'hex')).update(KEY_CONTEXT).digest();
}
export function hashTrialIdentity(kind: TrialIdentity, value: string): string {
  const normalized = kind === 'email' ? canonicalizeTrialEmail(value) : fingerprint(value);
  if (!normalized) throw new HttpError(400, 'L’identité de paiement ne peut pas être vérifiée.');
  return createHmac('sha256', identityKey()).update(`${HASH_CONTEXT}\0${kind}\0${normalized}`).digest('hex');
}

/** Twelve calendar months; a leap-day claim expires on February 28 next year. */
export function trialRetentionExpiry(claimedAt: Date): Date {
  const result = new Date(claimedAt);
  if (!Number.isFinite(result.getTime())) throw new TypeError('A valid claim timestamp is required.');
  const month = result.getUTCMonth();
  result.setUTCFullYear(result.getUTCFullYear() + 1);
  if (result.getUTCMonth() !== month) result.setUTCDate(0);
  return result;
}

/** Each invocation removes at most 500 expired rows. Call on monthly claims;
 * a daily scheduled invocation also bounds retention when no new claims arrive. */
export async function purgeExpiredTrialUsage(now = new Date(), limit = MAX_PURGE_BATCH): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('A positive purge limit is required.');
  const expired = await db.trialUsage.findMany({
    where: { expiresAt: { lte: now } }, select: { id: true }, orderBy: { expiresAt: 'asc' }, take: Math.min(limit, MAX_PURGE_BATCH),
  });
  if (!expired.length) return 0;
  const removed = await db.trialUsage.deleteMany({ where: { id: { in: expired.map(row => row.id) }, expiresAt: { lte: now } } });
  return removed.count;
}

/** Provisional checkout offer only: a card collected later must still pass the
 * atomic webhook claim before the application activates a monthly trial. */
export async function canOfferMonthlyTrial(input: { email: string; cardFingerprint?: string | null }, now = new Date()): Promise<boolean> {
  const emailHash = hashTrialIdentity('email', input.email);
  const card = fingerprint(input.cardFingerprint);
  if (input.cardFingerprint != null && !card) return false;
  const cardHash = card ? hashTrialIdentity('card', card) : undefined;
  const known = await db.trialUsage.findFirst({
    where: { expiresAt: { gt: now }, OR: [{ emailHash }, ...(cardHash ? [{ cardHash }] : [])] }, select: { id: true },
  });
  return !known;
}

function matchesIdentity(row: { emailHash: string; cardHash: string }, emailHash: string, cardHash: string): boolean {
  return row.emailHash === emailHash && row.cardHash === cardHash;
}
function knownPrismaError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

/** Claims both identities atomically using database UNIQUE constraints. The
 * registry deliberately has no User relation, so account deletion cannot reset it.
 * Paid subscriptions and annual subscriptions never acquire a trial registry row. */
export async function claimMonthlyTrial(input: TrialClaimInput, now = new Date()): Promise<TrialClaimResult> {
  if (input.interval !== 'month' || !input.hasTrial) return { allowed: true, reason: 'not_applicable' };
  const card = fingerprint(input.cardFingerprint);
  if (!card) return { allowed: false, reason: 'unverifiable_card' };
  const emailHash = hashTrialIdentity('email', input.email); const cardHash = hashTrialIdentity('card', card);
  const stripeSubscriptionId = z.string().min(1).max(255).parse(input.stripeSubscriptionId);
  await purgeExpiredTrialUsage(now);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async tx => {
        // Expired identities can be reused even if an older purge backlog remains.
        // The unique indexes limit this targeted deletion to at most three rows.
        await tx.trialUsage.deleteMany({ where: { expiresAt: { lte: now }, OR: [{ emailHash }, { cardHash }, { stripeSubscriptionId }] } });
        const previous = await tx.trialUsage.findUnique({ where: { stripeSubscriptionId } });
        if (previous) return matchesIdentity(previous, emailHash, cardHash)
          ? { allowed: true, reason: 'same_subscription' as const }
          : { allowed: false, reason: 'identity_mismatch' as const };
        await tx.trialUsage.create({ data: { stripeSubscriptionId, emailHash, cardHash, claimedAt: now, expiresAt: trialRetentionExpiry(now) } });
        return { allowed: true, reason: 'claimed' as const };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (knownPrismaError(error, 'P2034') && attempt < 2) continue;
      if (knownPrismaError(error, 'P2002')) {
        // A concurrent duplicate event for this same trial is idempotent; a
        // different subscription competing for either identity must be paid.
        const previous = await db.trialUsage.findUnique({ where: { stripeSubscriptionId } });
        if (previous && previous.expiresAt > now) return matchesIdentity(previous, emailHash, cardHash)
          ? { allowed: true, reason: 'same_subscription' }
          : { allowed: false, reason: 'identity_mismatch' };
        return { allowed: false, reason: 'identity_used' };
      }
      throw error;
    }
  }
  // A serialization failure never becomes an implicit approval.
  throw new HttpError(503, 'La vérification des essais doit être réessayée.');
}
