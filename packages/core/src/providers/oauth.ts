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
  protected async tokenRequest(parameters: Record<string, string>, persist = true): Promise<string> {
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
    if(persist)await this.config.onTokens?.(this.credentials);
    return result.access_token;
  }
  protected async accessToken(invalidAccessToken?:string): Promise<string> {
    const usable=()=>!!this.credentials.accessToken&&this.credentials.accessToken!==invalidAccessToken&&(this.credentials.expiresAt===undefined||this.credentials.expiresAt>Date.now()+60000);
    if(usable())return this.credentials.accessToken!;
    if(!this.refreshInFlight){
      this.refreshInFlight=(async()=>{
        const refresh=async(latest:ProviderCredentials)=>{
          // Keep candidate resource IDs in this instance; only tokens may be reloaded.
          this.credentials={...this.credentials,accessToken:latest.accessToken,refreshToken:latest.refreshToken,expiresAt:latest.expiresAt};
          // Another process may already have refreshed the expired/revoked token.
          if(usable())return this.credentials;
          const refreshToken=requireValue(this.credentials.refreshToken,'accessToken or refreshToken');
          await this.tokenRequest({grant_type:'refresh_token',refresh_token:refreshToken},!this.config.refreshCredentials);
          return this.credentials;
        };
        const updated=this.config.refreshCredentials?await this.config.refreshCredentials(refresh):await refresh(this.credentials);
        this.credentials={...this.credentials,accessToken:updated.accessToken,refreshToken:updated.refreshToken,expiresAt:updated.expiresAt};
        return requireValue(this.credentials.accessToken,'refreshed accessToken');
      })().finally(()=>{this.refreshInFlight=undefined});
    }
    return this.refreshInFlight;
  }
  protected async authorized<T>(url: string, init: RequestInit = {}): Promise<T> {
    const headers = { ...Object.fromEntries(new Headers(init.headers).entries()), Authorization: `Bearer ${await this.accessToken()}` };
    try { return await providerRequest<T>(this.request, url, { ...init, headers }); }
    catch (error) {
      if (!(error instanceof ProviderError) || error.code !== 'authorization' || error.statusCode !== 401 || !this.credentials.refreshToken) throw error;
      // One refresh retry only. A revoked/forbidden scope remains an actionable failure.
      const rejectedToken=headers.Authorization.slice('Bearer '.length);
      headers.Authorization = `Bearer ${await this.accessToken(rejectedToken)}`;
      return providerRequest<T>(this.request, url, { ...init, headers });
    }
  }
}
