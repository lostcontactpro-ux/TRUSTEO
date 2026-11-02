import { beforeEach, describe, expect, it, vi } from 'vitest';
const queryRaw = vi.hoisted(() => vi.fn());
vi.mock('./db', () => ({ db: { $queryRaw: queryRaw } }));
import { guardMutation, hashToken, HttpError, jsonBody, passwordSchema, rateLimit, token } from './security';

function mutation(origin: string | undefined, contentType = 'application/json', fetchSite = 'same-origin') {
  return new Request('http://localhost:3000/api/auth/signup', { method: 'POST', headers: { ...(origin ? { origin } : {}), 'content-type': contentType, 'sec-fetch-site': fetchSite }, body: '{}' });
}
beforeEach(() => { process.env.APP_URL = 'http://localhost:3000'; queryRaw.mockReset(); });
describe('CSRF boundary', () => {
  it('accepts exact-origin JSON mutations', () => expect(() => guardMutation(mutation('http://localhost:3000'))).not.toThrow());
  it.each([undefined, 'https://attacker.example', 'http://localhost:3000.evil.test', 'null'])('rejects missing or foreign origin %s', (origin) => expect(() => guardMutation(mutation(origin))).toThrow(HttpError));
  it('rejects cross-site requests even with a spoofed origin', () => expect(() => guardMutation(mutation('http://localhost:3000', 'application/json', 'cross-site'))).toThrow());
  it('rejects cross-site form-compatible content types', () => expect(() => guardMutation(mutation('http://localhost:3000', 'text/plain'))).toThrow());
});
describe('session tokens and passwords', () => {
  it('creates high-entropy opaque tokens and stores only irreversible digests', () => {
    const a = token(); const b = token();
    expect(a).toMatch(/^[a-f0-9]{64}$/); expect(a).not.toEqual(b);
    expect(hashToken(a)).toHaveLength(64); expect(hashToken(a)).not.toEqual(a);
    expect(hashToken(a)).toEqual(hashToken(a));
  });
  it('rejects bcrypt truncation for multibyte inputs', () => {
    expect(passwordSchema.safeParse('a'.repeat(72)).success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(73)).success).toBe(false);
    expect(passwordSchema.safeParse('é'.repeat(37)).success).toBe(false);
    expect(passwordSchema.safeParse('é'.repeat(36)).success).toBe(true);
    expect(passwordSchema.safeParse('short').success).toBe(false);
  });
});
describe('shared rate limiting', () => {
  it('rejects a bucket past its limit and fails closed on missing rows', async () => {
    queryRaw.mockResolvedValueOnce([{ count: 3 }]); await expect(rateLimit('login:user', 3)).resolves.toBeUndefined();
    queryRaw.mockResolvedValueOnce([{ count: 4 }]); await expect(rateLimit('login:user', 3)).rejects.toMatchObject({ status: 429 });
    queryRaw.mockResolvedValueOnce([]); await expect(rateLimit('login:user', 3)).rejects.toMatchObject({ status: 429 });
  });
});
describe('bounded JSON inputs', () => {
  it('rejects malformed and oversized payloads', async () => {
    await expect(jsonBody(new Request('http://localhost', { method: 'POST', body: 'oops' }))).rejects.toMatchObject({ status: 400 });
    await expect(jsonBody(new Request('http://localhost', { method: 'POST', headers: { 'content-length': '1000001' }, body: '{}' }))).rejects.toMatchObject({ status: 413 });
  });
});
