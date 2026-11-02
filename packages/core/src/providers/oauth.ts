import { providerRequest, requireValue } from './http';
import { ProviderError, type ProviderConfig, type ProviderCredentials } from './types';

interface TokenResponse { access_token: string; refresh_token?: string; expires_in?: number }
/** No in-memory token logs. Refresh is serialized to avoid consuming rotating tokens twice. */
export abstract class OAuthProvider {
  protected readonly request: typeof fetch;
  protected credentials: ProviderCredentials;
  private refreshInFlight?: Promise<string>;
  protected abstract readonly tokenUrl: string;
  protected abstract tokenHeaders(): Record<string, string>;
  protected abstract tokenParameters(): Record<string, string>;
  constructor(protected readonly config: ProviderConfig) {
    this.request = config.fetch ?? fetch;
    this.credentials = { ...config.credentials };
  }
  protected async tokenRequest(parameters: Record<string, string>): Promise<string> {
    const result = await providerRequest<TokenResponse>(this.request, this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...this.tokenHeaders() },
      body: new URLSearchParams({ ...this.tokenParameters(), ...parameters }).toString(),
    });
    if (!result.access_token || typeof result.access_token !== 'string') throw new ProviderError('Invalid OAuth token response.', 'authorization');
    this.credentials = {
      ...this.credentials,
      accessToken: result.access_token,
      refreshToken: result.refresh_token ?? this.credentials.refreshToken,
      expiresAt: result.expires_in ? Date.now() + result.expires_in * 1000 : undefined,
    };
    await this.config.onTokens?.(this.credentials);
    return result.access_token;
  }
  protected async accessToken(): Promise<string> {
    if (this.credentials.accessToken && (this.credentials.expiresAt === undefined || this.credentials.expiresAt > Date.now() + 60000)) return this.credentials.accessToken;
    const refreshToken = requireValue(this.credentials.refreshToken, 'accessToken or refreshToken');
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }).finally(() => { this.refreshInFlight = undefined; });
    }
    return this.refreshInFlight;
  }
  protected async authorized<T>(url: string, init: RequestInit = {}): Promise<T> {
    const headers = { ...Object.fromEntries(new Headers(init.headers).entries()), Authorization: `Bearer ${await this.accessToken()}` };
    try { return await providerRequest<T>(this.request, url, { ...init, headers }); }
    catch (error) {
      if (!(error instanceof ProviderError) || error.code !== 'authorization' || error.statusCode !== 401 || !this.credentials.refreshToken) throw error;
      // One refresh retry only. A revoked/forbidden scope remains an actionable failure.
      this.credentials.expiresAt = 0;
      headers.Authorization = `Bearer ${await this.accessToken()}`;
      return providerRequest<T>(this.request, url, { ...init, headers });
    }
  }
}
