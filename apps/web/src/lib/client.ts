'use client';
export async function api<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init, headers: { ...(init?.body ? {'Content-Type':'application/json'} : {}), ...init?.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Une erreur est survenue. Réessayez.');
  return payload as T;
}
export const json = (method: string, body?: unknown): RequestInit => ({method, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
