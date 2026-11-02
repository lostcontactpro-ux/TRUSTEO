import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function keyBytes(key = process.env.CREDENTIAL_ENCRYPTION_KEY): Buffer {
  if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) throw new Error('CREDENTIAL_ENCRYPTION_KEY must be exactly 32 random bytes encoded as 64 hexadecimal characters.');
  return Buffer.from(key, 'hex');
}

/** Encrypts OAuth credentials at rest. Never pass the secret key through client code. */
export function encryptCredentials(value: unknown, key?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  cipher.setAAD(Buffer.from('trusteo-provider-credentials:v1'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptCredentials<T = Record<string, unknown>>(value: string, key?: string): T {
  const [version, iv, tag, ciphertext, extra] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext || extra !== undefined) throw new Error('Invalid encrypted credential envelope.');
  const ivBytes = Buffer.from(iv, 'base64url'); const tagBytes = Buffer.from(tag, 'base64url');
  if (ivBytes.length !== 12 || tagBytes.length !== 16) throw new Error('Invalid encrypted credential envelope.');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), ivBytes);
  decipher.setAAD(Buffer.from('trusteo-provider-credentials:v1'));
  decipher.setAuthTag(tagBytes);
  const cleartext = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]);
  return JSON.parse(cleartext.toString('utf8')) as T;
}
