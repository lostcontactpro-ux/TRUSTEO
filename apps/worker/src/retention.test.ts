import { beforeEach, describe, expect, it, vi } from 'vitest';
type Trial = { id: string; expiresAt: Date };
type Receipt = { id: string; expiresAt: Date; claimedAt: Date | null; tokenEnvelope: string | null; checkoutSessionId: string; stripeCustomerId: string };
const state = vi.hoisted(() => ({
  trials: [] as Trial[], receipts: [] as Receipt[], trialFind: vi.fn(), trialDelete: vi.fn(), receiptFind: vi.fn(), receiptUpdate: vi.fn(), connectionFind: vi.fn(),
  beforeDelete: undefined as (() => void) | undefined, beforeUpdate: undefined as (() => void) | undefined,
}));
vi.mock('./runtime', () => ({
  db: {
    trialUsage: {
      findMany: async (input: { where: { expiresAt: { lte: Date } }; take: number }) => { state.trialFind(input); return state.trials.filter(row => row.expiresAt <= input.where.expiresAt.lte).sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime()).slice(0, input.take).map(row => ({ id: row.id })); },
      deleteMany: async (input: { where: { id: { in: string[] }; expiresAt: { lte: Date } } }) => {
        state.trialDelete(input); state.beforeDelete?.(); const before = state.trials.length;
        state.trials = state.trials.filter(row => !input.where.id.in.includes(row.id) || row.expiresAt > input.where.expiresAt.lte);
        return { count: before - state.trials.length };
      },
    },
    paymentReceipt: {
      findMany: async (input: { where: { expiresAt: { lte: Date } }; take: number }) => { state.receiptFind(input); return state.receipts.filter(row => row.claimedAt === null && row.tokenEnvelope !== null && row.expiresAt <= input.where.expiresAt.lte).sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime()).slice(0, input.take).map(row => ({ id: row.id })); },
      updateMany: async (input: { where: { id: { in: string[] }; claimedAt: null; expiresAt: { lte: Date }; tokenEnvelope: { not: null } }; data: { tokenEnvelope: null } }) => {
        state.receiptUpdate(input); state.beforeUpdate?.(); let count = 0;
        for (const row of state.receipts) if (input.where.id.in.includes(row.id) && (!Object.hasOwn(input.where, 'claimedAt') || row.claimedAt === input.where.claimedAt) && row.expiresAt <= input.where.expiresAt.lte && row.tokenEnvelope !== null) { row.tokenEnvelope = input.data.tokenEnvelope; count++; }
        return { count };
      },
    },
    providerConnection: { findMany: async () => { state.connectionFind(); return []; }, updateMany: vi.fn(async () => ({ count: 0 })) },
    notification: { findMany: vi.fn(async () => []) }, campaignRecipient: { findMany: vi.fn(async () => []) },
    rateLimit: { deleteMany: vi.fn() }, session: { deleteMany: vi.fn() }, passwordReset: { deleteMany: vi.fn() },
  },
  deliveryQueue: { addBulk: vi.fn() }, syncQueue: { addBulk: vi.fn() }, notificationQueue: {}, redis: {}, jobOptions: {},
}));
import { dispatch, purgeExpiredSensitiveData } from './jobs';
const now = new Date('2026-11-05T12:00:00Z');
function receipt(id: string, overrides: Partial<Receipt> = {}): Receipt { return { id, expiresAt: new Date(now.getTime() - 1), claimedAt: null, tokenEnvelope: 'encrypted-proof', checkoutSessionId: `cs_${id}`, stripeCustomerId: `cus_${id}`, ...overrides }; }
beforeEach(() => { vi.clearAllMocks(); state.trials = []; state.receipts = []; state.beforeDelete = undefined; state.beforeUpdate = undefined; });
describe('periodic sensitive-data retention', () => {
  it('deletes expired trial evidence and only clears expired unclaimed receipt envelopes', async () => {
    state.trials = [{ id: 'expired', expiresAt: now }, { id: 'active', expiresAt: new Date(now.getTime() + 1) }];
    state.receipts = [receipt('expired'), receipt('claimed', { claimedAt: now }), receipt('current', { expiresAt: new Date(now.getTime() + 1) }), receipt('already-cleared', { tokenEnvelope: null })];
    expect(await purgeExpiredSensitiveData(now)).toEqual({ trialUsagesDeleted: 1, receiptEnvelopesCleared: 1 });
    expect(state.trials.map(row => row.id)).toEqual(['active']);
    expect(state.receipts).toHaveLength(4);
    expect(state.receipts[0]).toMatchObject({ tokenEnvelope: null, checkoutSessionId: 'cs_expired', stripeCustomerId: 'cus_expired' });
    expect(state.receipts[1].tokenEnvelope).toBe('encrypted-proof'); expect(state.receipts[2].tokenEnvelope).toBe('encrypted-proof');
    expect(state.receiptUpdate.mock.calls[0][0].data).toEqual({ tokenEnvelope: null });
    expect(state.receiptFind.mock.calls[0][0].where).toEqual({ claimedAt: null, expiresAt: { lte: now }, tokenEnvelope: { not: null } });
  });
  it('caps each operation at 500 records so a backlog drains over multiple dispatches', async () => {
    state.trials = Array.from({ length: 501 }, (_, index) => ({ id: `old-${index}`, expiresAt: new Date(now.getTime() - 1) }));
    state.receipts = Array.from({ length: 501 }, (_, index) => receipt(`old-${index}`));
    expect(await purgeExpiredSensitiveData(now)).toEqual({ trialUsagesDeleted: 500, receiptEnvelopesCleared: 500 });
    expect(state.trials).toHaveLength(1); expect(state.receipts.filter(row => row.tokenEnvelope !== null)).toHaveLength(1);
    expect(await purgeExpiredSensitiveData(now)).toEqual({ trialUsagesDeleted: 1, receiptEnvelopesCleared: 1 });
  });
  it('does not erase a receipt renewed between selection and update', async () => {
    state.receipts = [receipt('renewed')];
    state.beforeUpdate = () => { state.receipts[0].expiresAt = new Date(now.getTime() + 60000); state.receipts[0].tokenEnvelope = 'fresh-encrypted-proof'; };
    expect(await purgeExpiredSensitiveData(now)).toEqual({ trialUsagesDeleted: 0, receiptEnvelopesCleared: 0 });
    expect(state.receipts[0].tokenEnvelope).toBe('fresh-encrypted-proof');
  });
  it('does not erase a receipt claimed between selection and update', async () => {
    state.receipts = [receipt('claimed-concurrently')]; state.beforeUpdate = () => { state.receipts[0].claimedAt = now; };
    expect((await purgeExpiredSensitiveData(now)).receiptEnvelopesCleared).toBe(0);
    expect(state.receipts[0].tokenEnvelope).toBe('encrypted-proof');
  });
  it('rechecks trial expiration before deleting a selected record', async () => {
    state.trials = [{ id: 'updated', expiresAt: now }]; state.beforeDelete = () => { state.trials[0].expiresAt = new Date(now.getTime() + 60000); };
    expect((await purgeExpiredSensitiveData(now)).trialUsagesDeleted).toBe(0); expect(state.trials).toHaveLength(1);
  });
  it('runs cleanup from the dispatcher even with no connections, notifications or campaign recipients', async () => {
    state.trials = [{ id: 'expired', expiresAt: new Date(0) }]; state.receipts = [receipt('expired', { expiresAt: new Date(0) })];
    state.connectionFind.mockImplementation(() => { expect(state.trials).toHaveLength(0); expect(state.receipts[0].tokenEnvelope).toBeNull(); });
    await dispatch(); expect(state.connectionFind).toHaveBeenCalledOnce();
  });
});
