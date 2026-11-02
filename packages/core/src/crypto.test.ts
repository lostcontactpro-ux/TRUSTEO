import { describe, expect, it } from 'vitest';
import { decryptCredentials, encryptCredentials } from './crypto';
const key = 'a'.repeat(64);
describe('OAuth credential encryption', () => {
  it('round trips while using a fresh nonce for every encrypted value', () => {
    const credential = { accessToken: 'secret', refreshToken: 'refresh' };
    const a = encryptCredentials(credential, key); const b = encryptCredentials(credential, key);
    expect(a).not.toBe(b); expect(a).not.toContain('secret'); expect(decryptCredentials(a, key)).toEqual(credential);
  });
  it('rejects wrong keys and tampered ciphertext', () => {
    const envelope = encryptCredentials({ token: 'secret' }, key);
    expect(() => decryptCredentials(envelope, 'b'.repeat(64))).toThrow();
    const parts = envelope.split('.'); const data = Buffer.from(parts[3], 'base64url'); data[0] ^= 1; parts[3] = data.toString('base64url');
    expect(() => decryptCredentials(parts.join('.'), key)).toThrow();
  });
  it('refuses missing, malformed, and non-versioned plaintext credentials', () => {
    expect(() => encryptCredentials({}, 'weak')).toThrow(); expect(() => decryptCredentials('{"token":"secret"}', key)).toThrow();
  });
});
