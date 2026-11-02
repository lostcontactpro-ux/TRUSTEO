import { ProviderError } from './types';

/** Bound time, redact upstream bodies (they may contain customer data or tokens). */
export async function providerRequest<T>(request: typeof fetch, url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await request(url, { ...init, signal: init.signal ?? AbortSignal.timeout(20000) });
  } catch {
    throw new ProviderError('The provider could not be reached.', 'upstream', true);
  }
  if (!response.ok) {
    const retry = response.headers.get('retry-after');
    const seconds = retry ? (/^\d+$/.test(retry) ? Number(retry) : Math.max(1, Math.ceil((Date.parse(retry) - Date.now()) / 1000))) : undefined;
    if (response.status === 429) throw new ProviderError('Provider quota exceeded.', 'rate_limit', true, Number.isFinite(seconds) ? seconds : undefined);
    if (response.status === 401 || response.status === 403) throw new ProviderError('Provider authorization required.', 'authorization', false, undefined, response.status);
    throw new ProviderError(`Provider returned HTTP ${response.status}.`, 'upstream', response.status >= 500);
  }
  if (response.status === 204) return undefined as T;
  try { return await response.json() as T; }
  catch { throw new ProviderError('Provider returned an invalid JSON response.', 'upstream'); }
}

export function requireValue(value: string | undefined, name: string): string {
  if (!value) throw new ProviderError(`Missing provider configuration: ${name}.`, 'configuration');
  return value;
}
export function validReply(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 4000) throw new ProviderError('Reply must contain 1–4000 characters.', 'validation');
  return trimmed;
}
export function encodePath(value: string): string { return encodeURIComponent(value); }
