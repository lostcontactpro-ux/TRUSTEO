import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConnection } from '@prisma/client';
import { decryptCredentials, encryptCredentials } from '@trusteo/core/crypto';
import { ProviderError, type ProviderCredentials } from '@trusteo/core/providers/index';

const mocked = vi.hoisted(() => ({
  connection: null as ProviderConnection | null, owner: 'owner-1', reviewCount: 0, locationCount: 1,
  subscription: { plan: 'essential', status: 'active', currentPeriodEnd: new Date('2099-01-01') },
  update: vi.fn(), queryRaw: vi.fn(), preview: vi.fn(), makeProvider: vi.fn(),
}));
vi.mock('./db', () => {
  const tx = {
    $queryRaw: mocked.queryRaw,
    providerConnection: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; location: { userId: string } } }) => where.id === mocked.connection?.id && where.location.userId === mocked.owner ? structuredClone(mocked.connection) : null),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; previewTokenHash: string }, data: Partial<ProviderConnection> }) => {
        if (where.id !== mocked.connection?.id || where.previewTokenHash !== mocked.connection.previewTokenHash) return { count: 0 };
        mocked.update(data); mocked.connection = { ...mocked.connection!, ...data }; return { count: 1 };
      }),
      update: vi.fn(async ({ data }: { data: Partial<ProviderConnection> }) => {
        mocked.update(data); mocked.connection = { ...mocked.connection!, ...data }; return structuredClone(mocked.connection);
      }),
    },
    user: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => where.id === mocked.owner ? { id: mocked.owner, subscription: mocked.subscription } : null) },
    location: { count: vi.fn(async () => mocked.locationCount) },
    review: { count: vi.fn(async () => mocked.reviewCount) },
  };
  return { db: { ...tx, $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) } };
});
vi.mock('./providers', async importOriginal => ({ ...await importOriginal<object>(), makeProvider: mocked.makeProvider }));
import {
  candidatePreviewCredentials, clearedConnectionPreview, confirmBusinessConnection,
  connectionSnapshotFingerprint, readConnectionPreviewReceipt, testBusinessConnection,
  type BusinessConnectionPreview, type ConnectionPreviewReceipt,
} from './connection-preview';
import { hashToken } from './security';

const now = new Date('2026-11-03T12:00:00Z');
const rawToken = 'ab'.repeat(32);
const source: ProviderCredentials = { accessToken: 'source-access', refreshToken: 'source-refresh', expiresAt: 4_000_000_000_000, businessUnitId: 'business-1' };
function connection(): ProviderConnection {
  return {
    id: 'connection-1', locationId: 'location-1', platform: 'trustpilot', mode: 'api', status: 'pending', authMethod: 'oauth',
    credentials: encryptCredentials(source), externalId: null, inboxToken: null, lastSyncedAt: null, lastError: null,
    pendingPreview: null, previewTokenHash: null, previewExpiresAt: null, testedAt: null, confirmedAt: null,
    createdAt: now, updatedAt: now,
  };
}
function preview(authMethod: 'oauth' | 'apiKey' = 'oauth'): BusinessConnectionPreview {
  return { platform: 'trustpilot', businessId: 'business-1', name: 'Bistrot du Marché', address: 'Paris', website: 'https://bistrot.example.com', sourceUrl: 'https://www.trustpilot.com/review/bistrot.example.com', rating: 4.3, reviewCount: 80, reviews: [], authMethod, managementVerified: authMethod === 'oauth' };
}
function stage(authMethod: 'oauth' | 'apiKey' = 'oauth', candidateCredentials?: ProviderCredentials) {
  const current = mocked.connection!; const expiresAt = new Date(now.getTime() + 600_000);
  const receipt: ConnectionPreviewReceipt = {
    version: 1, userId: mocked.owner, connectionId: current.id, sourceFingerprint: connectionSnapshotFingerprint(current),
    candidateCredentials: candidateCredentials ?? source, preview: preview(authMethod), testedAt: now, expiresAt,
  };
  mocked.connection = { ...current, pendingPreview: encryptCredentials(receipt), previewTokenHash: hashToken(rawToken), previewExpiresAt: expiresAt };
  return receipt;
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  process.env.CREDENTIAL_ENCRYPTION_KEY = 'a'.repeat(64);
  mocked.owner = 'owner-1'; mocked.reviewCount = 0; mocked.locationCount = 1;
  mocked.subscription = { plan: 'essential', status: 'active', currentPeriodEnd: new Date('2099-01-01') };
  mocked.connection = connection(); mocked.queryRaw.mockResolvedValue([]);
  mocked.preview.mockResolvedValue(preview()); mocked.makeProvider.mockReturnValue({ previewBusiness: mocked.preview });
});

describe('candidate authentication and fingerprints', () => {
  it('removes OAuth capabilities from an API-key candidate and reuses only a stored key when omitted', () => {
    const candidate = candidatePreviewCredentials(mocked.connection!, { authMethod: 'apiKey', apiKey: 'private-api-key' });
    expect(candidate).toEqual({ apiKey: 'private-api-key', businessUnitId: 'business-1' });
    expect(mocked.connection!.credentials).not.toContain('private-api-key');
    mocked.connection!.credentials = encryptCredentials({ ...source, apiKey: 'stored-key' });
    expect(candidatePreviewCredentials(mocked.connection!, { authMethod: 'apiKey' })).toEqual({ apiKey: 'stored-key', businessUnitId: 'business-1' });
  });
  it('rejects a Google API key and missing OAuth tokens', () => {
    mocked.connection!.platform = 'google';
    expect(() => candidatePreviewCredentials(mocked.connection!, { authMethod: 'apiKey', apiKey: 'key' })).toThrow('Google Business Profile nécessite OAuth');
    mocked.connection!.credentials = encryptCredentials({ accountId: 'account', remoteLocationId: 'location' });
    expect(() => candidatePreviewCredentials(mocked.connection!, { authMethod: 'oauth' })).toThrow('OAuth');
  });
  it('fingerprints semantic credentials rather than random encryption nonces', () => {
    const a = connectionSnapshotFingerprint(mocked.connection!);
    mocked.connection!.credentials = encryptCredentials({ businessUnitId: source.businessUnitId, expiresAt: source.expiresAt, refreshToken: source.refreshToken, accessToken: source.accessToken });
    expect(connectionSnapshotFingerprint(mocked.connection!)).toBe(a);
    mocked.connection!.credentials = encryptCredentials({ ...source, accessToken: 'rotated' });
    expect(connectionSnapshotFingerprint(mocked.connection!)).not.toBe(a);
  });
});

describe('read-only business tests', () => {
  it('persists only an encrypted receipt without activating, importing, or exposing the key', async () => {
    mocked.connection!.status = 'connected'; mocked.connection!.confirmedAt = new Date('2026-11-01');
    const originalCredentials = mocked.connection!.credentials; const confirmedAt = mocked.connection!.confirmedAt;
    mocked.preview.mockResolvedValue(preview('apiKey'));
    const result = await testBusinessConnection(structuredClone(mocked.connection!), mocked.owner, { authMethod: 'apiKey', apiKey: 'private-api-key' });
    expect(result.preview.managementVerified).toBe(false); expect(result.preview.authMethod).toBe('apiKey');
    expect(JSON.stringify(result)).not.toContain('private-api-key');
    expect(mocked.connection!.status).toBe('connected'); expect(mocked.connection!.confirmedAt).toEqual(confirmedAt);
    expect(mocked.connection!.credentials).toBe(originalCredentials); expect(mocked.connection!.authMethod).toBe('oauth');
    expect(mocked.connection!.pendingPreview).not.toContain('private-api-key');
    expect(Object.keys(mocked.update.mock.calls[0][0]).sort()).toEqual(['pendingPreview', 'previewExpiresAt', 'previewTokenHash']);
    const receipt = readConnectionPreviewReceipt(mocked.connection!, result.previewToken, mocked.owner);
    expect(receipt.candidateCredentials).toEqual({ apiKey: 'private-api-key', businessUnitId: 'business-1' });
    expect(result.expiresAt.getTime() - result.testedAt.getTime()).toBe(600_000);
  });
  it('does not issue a receipt when the real read test fails', async () => {
    mocked.preview.mockRejectedValueOnce(new ProviderError('Access denied', 'authorization'));
    await expect(testBusinessConnection(mocked.connection!, mocked.owner, { authMethod: 'oauth' })).rejects.toMatchObject({ code: 'authorization' });
    expect(mocked.connection).toMatchObject({ ...clearedConnectionPreview, status: 'pending' });
    expect(mocked.update.mock.calls.every(([data]) => !('credentials' in data) && !('status' in data) && !('confirmedAt' in data))).toBe(true);
  });
  it('rejects a mismatched business response and invalidates an earlier successful receipt', async () => {
    stage();
    mocked.preview.mockResolvedValueOnce({ ...preview(), businessId: 'different-business' });
    await expect(testBusinessConnection(mocked.connection!, mocked.owner, { authMethod: 'oauth' })).rejects.toMatchObject({ status: 502 });
    expect(mocked.connection!.pendingPreview).toBeNull();
    expect(() => readConnectionPreviewReceipt(mocked.connection!, rawToken, mocked.owner)).toThrow('nouveau test');
  });
  it('never lets an older slow test recreate proof after a newer failed test', async () => {
    let finishOld!: (value: BusinessConnectionPreview) => void;
    const oldRead = new Promise<BusinessConnectionPreview>(resolve => { finishOld = resolve; });
    mocked.preview.mockReturnValueOnce(oldRead).mockRejectedValueOnce(new ProviderError('Later read failed', 'authorization'));
    const older = testBusinessConnection(structuredClone(mocked.connection!), mocked.owner, { authMethod: 'oauth' });
    await vi.waitFor(() => expect(mocked.preview).toHaveBeenCalledTimes(1));
    await expect(testBusinessConnection(structuredClone(mocked.connection!), mocked.owner, { authMethod: 'oauth' })).rejects.toMatchObject({ code: 'authorization' });
    finishOld(preview());
    await expect(older).rejects.toMatchObject({ status: 409 });
    expect(mocked.connection).toMatchObject(clearedConnectionPreview);
  });

});

describe('receipt integrity and ownership', () => {
  it('rejects wrong tokens, wrong receipt owners, and expiration', () => {
    stage(); expect(() => readConnectionPreviewReceipt(mocked.connection!, 'cd'.repeat(32), mocked.owner)).toThrow('ne correspond pas');
    expect(() => readConnectionPreviewReceipt(mocked.connection!, rawToken, 'other-owner')).toThrow('autre connexion');
    expect(() => readConnectionPreviewReceipt(mocked.connection!, rawToken, mocked.owner, new Date(now.getTime() + 600_000))).toThrow('expiré');
  });
  it('rejects modified encrypted receipts and source credential changes', () => {
    stage(); const parts = mocked.connection!.pendingPreview!.split('.'); const tag = Buffer.from(parts[2], 'base64url'); tag[0] ^= 1; parts[2] = tag.toString('base64url'); mocked.connection!.pendingPreview = parts.join('.');
    expect(() => readConnectionPreviewReceipt(mocked.connection!, rawToken, mocked.owner)).toThrow('invalide');
    stage(); mocked.connection!.credentials = encryptCredentials({ ...source, accessToken: 'rotated-after-test' });
    expect(() => readConnectionPreviewReceipt(mocked.connection!, rawToken, mocked.owner)).toThrow('changé depuis le test');
  });
});

describe('atomic explicit confirmation', () => {
  it('consumes the receipt once and never restores a stale candidate OAuth token', async () => {
    stage('oauth', { ...source, accessToken: 'old-candidate-token' });
    const updated = await confirmBusinessConnection('connection-1', mocked.owner, rawToken);
    expect(updated).toMatchObject({ ...clearedConnectionPreview, status: 'connected', authMethod: 'oauth', testedAt: now, confirmedAt: now });
    expect(decryptCredentials(updated.credentials!)).toEqual(source);
    await expect(confirmBusinessConnection('connection-1', mocked.owner, rawToken)).rejects.toMatchObject({ status: 409 });
    expect(mocked.update).toHaveBeenCalledTimes(1);
  });
  it('does not expose a connection or consume its receipt to another tenant', async () => {
    stage(); await expect(confirmBusinessConnection('connection-1', 'other-owner', rawToken)).rejects.toMatchObject({ status: 404 }); expect(mocked.update).not.toHaveBeenCalled();
  });
  it('blocks resource remapping once reviews exist', async () => {
    stage('oauth', { ...source, businessUnitId: 'another-business' }); mocked.reviewCount = 1;
    await expect(confirmBusinessConnection('connection-1', mocked.owner, rawToken)).rejects.toMatchObject({ status: 409 }); expect(mocked.update).not.toHaveBeenCalled();
  });
  it('rechecks the paid entitlement and aggregate location cap inside the transaction', async () => {
    stage(); mocked.locationCount = 4;
    await expect(confirmBusinessConnection('connection-1', mocked.owner, rawToken)).rejects.toMatchObject({ status: 403 });
    mocked.locationCount = 1; mocked.subscription.currentPeriodEnd = new Date(0);
    await expect(confirmBusinessConnection('connection-1', mocked.owner, rawToken)).rejects.toMatchObject({ status: 402 }); expect(mocked.update).not.toHaveBeenCalled();
  });
  it('confirms a public key only as read-only credentials without retaining OAuth tokens', async () => {
    stage('apiKey', { apiKey: 'new-key', businessUnitId: 'business-1' });
    const updated = await confirmBusinessConnection('connection-1', mocked.owner, rawToken);
    expect(updated.authMethod).toBe('apiKey'); expect(decryptCredentials(updated.credentials!)).toEqual({ apiKey: 'new-key', businessUnitId: 'business-1' });
  });
});
