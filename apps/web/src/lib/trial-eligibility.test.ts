import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

type Row = { id: string; stripeSubscriptionId: string; emailHash: string; cardHash: string; claimedAt: Date; expiresAt: Date };
const state = vi.hoisted(() => ({ rows: [] as Row[], nextId: 1, serializationFailures: 0, transactions: vi.fn(), creates: vi.fn(), finds: vi.fn() }));
vi.mock('./db', async () => {
  const { Prisma } = await import('@prisma/client');
  type Where = { id?: string | { in: string[] }; stripeSubscriptionId?: string; emailHash?: string; cardHash?: string; expiresAt?: { lte?: Date; gt?: Date }; OR?: Where[] };
  const match = (row: Row, where: Where): boolean => {
    if (where.id && (typeof where.id === 'string' ? row.id !== where.id : !where.id.in.includes(row.id))) return false;
    if (where.stripeSubscriptionId && row.stripeSubscriptionId !== where.stripeSubscriptionId) return false;
    if (where.emailHash && row.emailHash !== where.emailHash) return false;
    if (where.cardHash && row.cardHash !== where.cardHash) return false;
    if (where.expiresAt?.lte && row.expiresAt > where.expiresAt.lte) return false;
    if (where.expiresAt?.gt && row.expiresAt <= where.expiresAt.gt) return false;
    return !where.OR || where.OR.some(alternative => match(row, alternative));
  };
  const delegate = {
    findMany: vi.fn(async ({ where, take }: { where: Where; take: number }) => state.rows.filter(row => match(row, where)).sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime()).slice(0, take).map(row => ({ id: row.id }))),
    findFirst: vi.fn(async ({ where }: { where: Where }) => { state.finds(where); return state.rows.find(row => match(row, where)) ?? null; }),
    findUnique: vi.fn(async ({ where }: { where: Where }) => state.rows.find(row => match(row, where)) ?? null),
    deleteMany: vi.fn(async ({ where }: { where: Where }) => { const before = state.rows.length; state.rows = state.rows.filter(row => !match(row, where)); return { count: before - state.rows.length }; }),
    create: vi.fn(async ({ data }: { data: Omit<Row, 'id'> }) => {
      state.creates(data);
      // Simulate the actual database's three unique indexes, including races in
      // which several transactions all observed no previous row before insertion.
      if (state.rows.some(row => row.stripeSubscriptionId === data.stripeSubscriptionId || row.emailHash === data.emailHash || row.cardHash === data.cardHash)) throw new Prisma.PrismaClientKnownRequestError('Unique trial identity', { code: 'P2002', clientVersion: '6.19.3' });
      const row = { id: `trial-${state.nextId++}`, ...data }; state.rows.push(row); return row;
    }),
  };
  return { db: { trialUsage: delegate, $transaction: vi.fn(async (fn: (tx: { trialUsage: typeof delegate }) => Promise<unknown>, options: unknown) => {
    state.transactions(options);
    if (state.serializationFailures-- > 0) throw new Prisma.PrismaClientKnownRequestError('Serialization conflict', { code: 'P2034', clientVersion: '6.19.3' });
    return fn({ trialUsage: delegate });
  }) } };
});
import { canOfferMonthlyTrial, canonicalizeTrialEmail, claimMonthlyTrial, hashTrialIdentity, purgeExpiredTrialUsage, trialRetentionExpiry, type TrialClaimInput } from './trial-eligibility';
const now = new Date('2026-11-05T12:00:00Z');
const request = (overrides: Partial<TrialClaimInput> = {}): TrialClaimInput => ({ stripeSubscriptionId: 'sub_first', email: 'client@example.com', cardFingerprint: 'StripeCaseSensitiveCard', interval: 'month', hasTrial: true, ...overrides });
beforeEach(() => { vi.clearAllMocks(); state.rows = []; state.nextId = 1; state.serializationFailures = 0; process.env.CREDENTIAL_ENCRYPTION_KEY = 'ab'.repeat(32); });

describe('minimal canonicalization and pseudonymous identities', () => {
  it('canonicalizes Gmail and Googlemail aliases without applying Gmail rules elsewhere', () => {
    expect(canonicalizeTrialEmail('  First.Last+restaurant@GoogleMail.com  ')).toBe('firstlast@gmail.com');
    expect(canonicalizeTrialEmail('F.i.r.s.t.Last+other@gmail.com')).toBe('firstlast@gmail.com');
    expect(canonicalizeTrialEmail(' First.Last+restaurant@Example.COM ')).toBe('first.last+restaurant@example.com');
    expect(canonicalizeTrialEmail('First.Last+restaurant@outlook.com')).toBe('first.last+restaurant@outlook.com');
  });
  it('uses secret, domain-separated HMACs and does not store raw email or fingerprint', async () => {
    const emailHash = hashTrialIdentity('email', 'First.Last+shop@gmail.com');
    expect(emailHash).toBe(hashTrialIdentity('email', 'firstlast@googlemail.com'));
    expect(emailHash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashTrialIdentity('card', 'client@example.com')).not.toBe(hashTrialIdentity('email', 'client@example.com'));
    expect(hashTrialIdentity('card', 'CaseSensitive')).not.toBe(hashTrialIdentity('card', 'casesensitive'));
    await claimMonthlyTrial(request(), now);
    const stored = state.creates.mock.calls[0][0];
    expect(stored).not.toHaveProperty('email'); expect(stored).not.toHaveProperty('cardFingerprint');
    expect(JSON.stringify(stored)).not.toContain('client@example.com'); expect(JSON.stringify(stored)).not.toContain('StripeCaseSensitiveCard');
  });
  it('fails closed on an absent HMAC key while leaving paid/annual bypass available', async () => {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    await expect(canOfferMonthlyTrial({ email: 'client@example.com' }, now)).rejects.toMatchObject({ status: 503 });
    await expect(claimMonthlyTrial(request(), now)).rejects.toMatchObject({ status: 503 });
    expect(await claimMonthlyTrial(request({ interval: 'year' }), now)).toEqual({ allowed: true, reason: 'not_applicable' });
    expect(await claimMonthlyTrial(request({ hasTrial: false }), now)).toEqual({ allowed: true, reason: 'not_applicable' });
    expect(state.transactions).not.toHaveBeenCalled();
  });
});

describe('provisional monthly checkout offer', () => {
  it('offers only provisionally without a card, then excludes known email aliases and known cards', async () => {
    expect(await canOfferMonthlyTrial({ email: 'First.Last+one@gmail.com' }, now)).toBe(true);
    await claimMonthlyTrial(request({ email: 'First.Last+one@gmail.com' }), now);
    expect(await canOfferMonthlyTrial({ email: 'firstlast+two@googlemail.com' }, now)).toBe(false);
    expect(await canOfferMonthlyTrial({ email: 'different@example.com', cardFingerprint: 'StripeCaseSensitiveCard' }, now)).toBe(false);
    expect(await canOfferMonthlyTrial({ email: 'different@example.com' }, now)).toBe(true);
  });
  it('does not offer a trial for an explicitly unusable card identifier', async () => {
    expect(await canOfferMonthlyTrial({ email: 'client@example.com', cardFingerprint: '' }, now)).toBe(false);
  });
});

describe('atomic webhook claim', () => {
  it('claims a verified monthly trial once and makes identical Stripe redeliveries idempotent', async () => {
    expect(await claimMonthlyTrial(request(), now)).toEqual({ allowed: true, reason: 'claimed' });
    expect(await claimMonthlyTrial(request(), now)).toEqual({ allowed: true, reason: 'same_subscription' });
    expect(state.rows).toHaveLength(1); expect(state.creates).toHaveBeenCalledTimes(1);
    expect(state.transactions).toHaveBeenCalledWith({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  });
  it('requires a verifiable card and rejects the same card under a new email/account', async () => {
    expect(await claimMonthlyTrial(request({ cardFingerprint: null }), now)).toEqual({ allowed: false, reason: 'unverifiable_card' });
    expect(state.transactions).not.toHaveBeenCalled();
    await claimMonthlyTrial(request(), now);
    expect(await claimMonthlyTrial(request({ stripeSubscriptionId: 'sub_other', email: 'another@example.com' }), now)).toEqual({ allowed: false, reason: 'identity_used' });
    expect(state.rows).toHaveLength(1);
  });
  it('rejects a reused Gmail identity with a new card and a mismatched redelivery', async () => {
    await claimMonthlyTrial(request({ email: 'First.Last+one@gmail.com' }), now);
    expect(await claimMonthlyTrial(request({ stripeSubscriptionId: 'sub_alias', email: 'firstlast+two@googlemail.com', cardFingerprint: 'NewCard' }), now)).toEqual({ allowed: false, reason: 'identity_used' });
    expect(await claimMonthlyTrial(request({ cardFingerprint: 'NewCard' }), now)).toEqual({ allowed: false, reason: 'identity_mismatch' });
    expect(state.rows).toHaveLength(1);
  });
  it('allows annual or paid monthly subscriptions without collecting trial identities', async () => {
    expect(await claimMonthlyTrial(request({ interval: 'year', cardFingerprint: null }), now)).toEqual({ allowed: true, reason: 'not_applicable' });
    expect(await claimMonthlyTrial(request({ hasTrial: false, cardFingerprint: null }), now)).toEqual({ allowed: true, reason: 'not_applicable' });
    expect(state.transactions).not.toHaveBeenCalled(); expect(state.creates).not.toHaveBeenCalled();
  });
  it('grants at most one new trial to simultaneous accounts sharing a card', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) => claimMonthlyTrial(request({ stripeSubscriptionId: `sub_concurrent_${index}`, email: `client${index}@example.com` }), now)));
    expect(results.filter(result => result.allowed)).toHaveLength(1);
    expect(results.filter(result => result.reason === 'identity_used')).toHaveLength(11);
    expect(state.rows).toHaveLength(1);
  });
  it('treats simultaneous delivery of the same subscription as one idempotent claim', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => claimMonthlyTrial(request(), now)));
    expect(results.every(result => result.allowed)).toBe(true);
    expect(results.filter(result => result.reason === 'claimed')).toHaveLength(1);
    expect(state.rows).toHaveLength(1);
  });
  it('retries serialization conflicts and never silently grants when retries are exhausted', async () => {
    state.serializationFailures = 2;
    expect(await claimMonthlyTrial(request(), now)).toEqual({ allowed: true, reason: 'claimed' });
    expect(state.transactions).toHaveBeenCalledTimes(3);
    state.rows = []; state.serializationFailures = 3;
    await expect(claimMonthlyTrial(request(), now)).rejects.toMatchObject({ code: 'P2034' });
    expect(state.rows).toHaveLength(0);
  });
});

describe('bounded retention independent of account lifecycle', () => {
  it('expires exactly twelve calendar months later, clamping leap day', () => {
    expect(trialRetentionExpiry(now)).toEqual(new Date('2027-11-05T12:00:00Z'));
    expect(trialRetentionExpiry(new Date('2024-02-29T08:00:00Z'))).toEqual(new Date('2025-02-28T08:00:00Z'));
  });
  it('purges at most 500 expired records while preserving current claims', async () => {
    for (let index = 0; index < 600; index++) state.rows.push({ id: `old-${index}`, stripeSubscriptionId: `sub_old_${index}`, emailHash: `email-${index}`, cardHash: `card-${index}`, claimedAt: new Date('2024-01-01'), expiresAt: new Date('2025-01-01') });
    await claimMonthlyTrial(request(), now); // also runs one bounded purge
    expect(state.rows.filter(row => row.id.startsWith('old-'))).toHaveLength(100);
    expect(await purgeExpiredTrialUsage(now, 10000)).toBe(100);
    expect(state.rows).toHaveLength(1); expect(state.rows[0].stripeSubscriptionId).toBe('sub_first');
    await expect(purgeExpiredTrialUsage(now, 0)).rejects.toThrow();
  });
  it('allows an expired identity to be reclaimed even beyond the global purge batch', async () => {
    const old = new Date('2025-01-01');
    for (let index = 0; index < 500; index++) state.rows.push({ id: `backlog-${index}`, stripeSubscriptionId: `sub_backlog_${index}`, emailHash: `email-${index}`, cardHash: `card-${index}`, claimedAt: new Date('2024-01-01'), expiresAt: old });
    state.rows.push({ id: 'expired-identity', stripeSubscriptionId: 'sub_expired', emailHash: hashTrialIdentity('email', 'client@example.com'), cardHash: hashTrialIdentity('card', 'StripeCaseSensitiveCard'), claimedAt: new Date('2025-02-01'), expiresAt: new Date('2026-02-01') });
    expect(await claimMonthlyTrial(request(), now)).toEqual({ allowed: true, reason: 'claimed' });
    expect(state.rows).toHaveLength(1); expect(state.rows[0].expiresAt).toEqual(new Date('2027-11-05T12:00:00Z'));
  });
});
