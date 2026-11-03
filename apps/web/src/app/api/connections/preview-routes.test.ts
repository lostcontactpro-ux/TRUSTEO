import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@trusteo/core/providers/index';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(), requireEntitlement: vi.fn(), rateLimit: vi.fn(),
  ownedConnection: vi.fn(), testBusinessConnection: vi.fn(), confirmBusinessConnection: vi.fn(),
  queueProviderSync: vi.fn(), publicConnection: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/entitlements', () => ({ requireEntitlement: mocks.requireEntitlement }));
vi.mock('@/lib/security', async importOriginal => ({ ...await importOriginal<object>(), rateLimit: mocks.rateLimit }));
vi.mock('@/lib/providers', () => ({
  ownedConnection: mocks.ownedConnection,
  publicConnection: mocks.publicConnection,
  queueProviderSync: mocks.queueProviderSync,
  makeProvider: vi.fn(), readProviderCredentials: vi.fn(),
  providerApiError: (error: unknown): never => {
    if (error instanceof ProviderError) throw new HttpError(error.code === 'authorization' ? 403 : 502, error.message);
    throw error;
  },
}));
vi.mock('@/lib/connection-preview', async importOriginal => ({
  ...await importOriginal<object>(),
  testBusinessConnection: mocks.testBusinessConnection,
  confirmBusinessConnection: mocks.confirmBusinessConnection,
}));
import { HttpError } from '@/lib/security';
import { POST as preview } from './[id]/preview/route';
import { POST as confirm } from './[id]/confirm/route';

const previewToken = 'a'.repeat(64);
const user = { id: 'owner-one', subscription: { status: 'active' } };
const connection = { id: 'connection-one', credentials: 'encrypted-secret-credential', pendingPreview: 'encrypted-preview-receipt' };
const publicDto = { id: 'connection-one', status: 'connected', authMethod: 'oauth' };
const context = () => ({ params: Promise.resolve({ id: connection.id }) });
function request(body: unknown, origin = 'http://localhost:3000') {
  return new Request(`http://localhost:3000/api/connections/${connection.id}/confirm`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_URL = 'http://localhost:3000';
  mocks.requireUser.mockResolvedValue(user);
  mocks.requireEntitlement.mockResolvedValue(undefined);
  mocks.rateLimit.mockResolvedValue(undefined);
  mocks.ownedConnection.mockResolvedValue(connection);
  mocks.confirmBusinessConnection.mockResolvedValue(connection);
  mocks.queueProviderSync.mockResolvedValue('sync-job');
  mocks.publicConnection.mockReturnValue(publicDto);
  mocks.testBusinessConnection.mockResolvedValue({ previewToken, preview: { name: 'Restaurant', authMethod: 'oauth' } });
});

describe('explicit connection confirmation HTTP boundary', () => {
  it('rejects accepted:false before consuming a receipt or queueing work', async () => {
    const response = await confirm(request({ previewToken, accepted: false }), context());
    expect(response.status).toBe(400);
    expect(mocks.confirmBusinessConnection).not.toHaveBeenCalled();
    expect(mocks.queueProviderSync).not.toHaveBeenCalled();
  });
  it('confirms the owned receipt, filters the response, then reports queued synchronization', async () => {
    const response = await confirm(request({ previewToken, accepted: true }), context());
    expect(response.status).toBe(200);
    expect(mocks.confirmBusinessConnection).toHaveBeenCalledWith(connection.id, user.id, previewToken);
    expect(mocks.queueProviderSync).toHaveBeenCalledWith(connection.id);
    expect(mocks.publicConnection).toHaveBeenCalledWith(connection);
    const body = await response.json();
    expect(body).toMatchObject({ connection: publicDto, syncQueued: true });
    expect(JSON.stringify(body)).not.toContain('encrypted-secret-credential');
    expect(JSON.stringify(body)).not.toContain('encrypted-preview-receipt');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('keeps a committed confirmation successful and reports Redis failure honestly', async () => {
    mocks.queueProviderSync.mockRejectedValueOnce(new Error('private queue configuration'));
    const response = await confirm(request({ previewToken, accepted: true }), context());
    expect(response.status).toBe(200);
    expect(mocks.confirmBusinessConnection).toHaveBeenCalledTimes(1);
    const body = await response.json();
    expect(body).toMatchObject({ connection: publicDto, syncQueued: false });
    expect(body.message).toContain('n’a pas pu être programmée');
    expect(JSON.stringify(body)).not.toContain('private queue configuration');
  });
  it('does not queue work when confirmation rejects a foreign owner', async () => {
    mocks.confirmBusinessConnection.mockRejectedValueOnce(new HttpError(404, 'Connexion introuvable.'));
    const response = await confirm(request({ previewToken, accepted: true }), context());
    expect(response.status).toBe(404);
    expect(mocks.queueProviderSync).not.toHaveBeenCalled();
  });
});

describe('preview and confirmation request defenses', () => {
  it.each([['preview', preview], ['confirm', confirm]] as const)('rejects cross-origin %s before any authentication, test or activation', async (_name, handler) => {
    const response = await handler(request({ previewToken, accepted: true, authMethod: 'oauth' }, 'https://foreign.example'), context());
    expect(response.status).toBe(403);
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.testBusinessConnection).not.toHaveBeenCalled();
    expect(mocks.confirmBusinessConnection).not.toHaveBeenCalled();
    expect(mocks.queueProviderSync).not.toHaveBeenCalled();
  });
  it.each([['preview', preview], ['confirm', confirm]] as const)('rejects unauthenticated %s without performing a test or activation', async (_name, handler) => {
    mocks.requireUser.mockRejectedValueOnce(new HttpError(401, 'Connectez-vous pour continuer.'));
    const response = await handler(request({ previewToken, accepted: true, authMethod: 'oauth' }), context());
    expect(response.status).toBe(401);
    expect(mocks.requireEntitlement).not.toHaveBeenCalled();
    expect(mocks.testBusinessConnection).not.toHaveBeenCalled();
    expect(mocks.confirmBusinessConnection).not.toHaveBeenCalled();
    expect(mocks.queueProviderSync).not.toHaveBeenCalled();
  });
  it('rejects a missing paid entitlement before making a provider read request', async () => {
    mocks.requireEntitlement.mockRejectedValueOnce(new HttpError(402, 'Abonnement requis.'));
    const response = await preview(request({ authMethod: 'oauth', accountId: 'account', remoteLocationId: 'location' }), context());
    expect(response.status).toBe(402);
    expect(mocks.ownedConnection).not.toHaveBeenCalled();
    expect(mocks.testBusinessConnection).not.toHaveBeenCalled();
    expect(mocks.confirmBusinessConnection).not.toHaveBeenCalled();
  });
});

describe('read-only preview HTTP boundary', () => {
  it('maps a provider read-test failure without activation or polling', async () => {
    mocks.testBusinessConnection.mockRejectedValueOnce(new ProviderError('Provider authorization required.', 'authorization'));
    const response = await preview(request({ authMethod: 'oauth', accountId: 'account', remoteLocationId: 'location' }), context());
    expect(response.status).toBe(403);
    expect(mocks.ownedConnection).toHaveBeenCalledWith(connection.id, user.id);
    expect(mocks.confirmBusinessConnection).not.toHaveBeenCalled();
    expect(mocks.queueProviderSync).not.toHaveBeenCalled();
  });
  it('returns a successful read test without confirming or enqueueing synchronization', async () => {
    const response = await preview(request({ authMethod: 'apiKey', apiKey: 'private-write-only-key', businessUnitId: 'unit-one' }), context());
    expect(response.status).toBe(200);
    expect(mocks.testBusinessConnection).toHaveBeenCalledWith(connection, user.id, { authMethod: 'apiKey', apiKey: 'private-write-only-key', businessUnitId: 'unit-one' });
    const body = await response.json();
    expect(body).toMatchObject({ previewToken, preview: { name: 'Restaurant' } });
    expect(JSON.stringify(body)).not.toContain('private-write-only-key');
    expect(mocks.confirmBusinessConnection).not.toHaveBeenCalled();
    expect(mocks.queueProviderSync).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
