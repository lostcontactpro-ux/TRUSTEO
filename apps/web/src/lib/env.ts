export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Configuration manquante : ${name}`);
  return value;
}

export function appUrl(): string {
  const value = process.env.APP_URL ?? 'http://localhost:3000';
  const url = new URL(value);
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('APP_URL doit utiliser HTTPS en production.');
  }
  return url.origin;
}
