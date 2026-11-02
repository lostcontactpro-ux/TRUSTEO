import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), set: vi.fn(), get: vi.fn(), delete: vi.fn() }));
vi.mock('./db', () => ({ db: { session: { findUnique: mocks.findUnique, create: mocks.create, deleteMany: mocks.deleteMany } } }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: mocks.get, set: mocks.set, delete: mocks.delete }) }));
import { createSession, currentUser, destroySession, publicUser, requireUser, SESSION_COOKIE } from './auth';
import { hashToken } from './security';
beforeEach(() => { vi.clearAllMocks(); mocks.create.mockResolvedValue({}); mocks.deleteMany.mockResolvedValue({ count: 1 }); });
describe('opaque database sessions', () => {
  it('keeps raw token only in an HttpOnly SameSite cookie', async () => {
    await createSession('user-1');
    const [name, raw, options] = mocks.set.mock.calls[0];
    expect(name).toBe(SESSION_COOKIE); expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ userId: 'user-1', tokenHash: hashToken(raw) });
    expect(mocks.create.mock.calls[0][0].data.tokenHash).not.toBe(raw);
  });
  it('rejects malformed cookies without querying the database', async () => {
    mocks.get.mockReturnValue({ value: 'tampered' }); expect(await currentUser()).toBeNull(); expect(mocks.findUnique).not.toHaveBeenCalled();
  });
  it('rejects expired sessions and unauthenticated requests', async () => {
    mocks.get.mockReturnValue({ value: 'a'.repeat(64) });
    mocks.findUnique.mockResolvedValue({ expiresAt: new Date(0), user: { id: 'user-1' } });
    expect(await currentUser()).toBeNull(); await expect(requireUser()).rejects.toMatchObject({ status: 401 });
  });
  it('revokes the current token during logout', async () => {
    const raw = 'b'.repeat(64); mocks.get.mockReturnValue({ value: raw }); await destroySession();
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { tokenHash: hashToken(raw) } }); expect(mocks.delete).toHaveBeenCalledWith(SESSION_COOKIE);
  });
  it('never serializes a password hash in public account data', () => {
    const user = { id: 'user-1', email: 'user@example.test', firstName: 'A', lastName: 'B', phone: null, notifyEmail: true, notifyPush: false, passwordHash: 'secret' };
    expect(publicUser(user)).not.toHaveProperty('passwordHash');
  });
});
