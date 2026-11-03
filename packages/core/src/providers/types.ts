import { z } from 'zod';

export const platformIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
/** Provider IDs remain open: discovery comes from each provider definition file. */
export type PlatformId = string;
export type ConnectionMode = 'api' | 'email' | 'assisted';
export interface ProviderCapabilities {
  canRead: boolean;
  canReply: boolean;
  realtime: boolean;
  requiresPartnership: boolean;
}
/** Source links are display-only; reject credentials and local network targets. */
export function isSafeSourceUrl(value: string): boolean {
  try {
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443'))return false;
    const host=url.hostname.toLowerCase().replace(/\.$/,'');
    if(!host.includes('.')||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||host.includes(':'))return false;
    if(/^\d+\.\d+\.\d+\.\d+$/.test(host)){
      const [a,b]=host.split('.').map(Number);
      if(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127))return false;
    }
    return true;
  }catch{return false;}
}
export const normalizedReviewSchema = z.object({
  externalId: z.string().min(1).max(500),
  platform: platformIdSchema,
  locationId: z.string().min(1),
  author: z.string().min(1).max(300),
  rating: z.number().min(0).max(5),
  text: z.string().max(30000),
  language: z.string().max(20).default('und'),
  publishedAt: z.coerce.date(),
  responseStatus: z.enum(['pending', 'replied']),
  sourceUrl: z.string().url().refine(isSafeSourceUrl, 'A public HTTPS source URL without credentials is required'),
  reply: z.string().max(10000).optional(),
});
export type NormalizedReview = z.infer<typeof normalizedReviewSchema>;
export const businessPreviewSchema=z.object({
  platform:platformIdSchema,businessId:z.string().min(1).max(500),name:z.string().trim().min(1).max(500),
  address:z.string().max(2000).nullable(),website:z.string().url().refine(isSafeSourceUrl).nullable(),
  sourceUrl:z.string().url().refine(isSafeSourceUrl),rating:z.number().min(0).max(5).nullable(),reviewCount:z.number().int().nonnegative().nullable(),
  reviews:z.array(normalizedReviewSchema).max(3),authMethod:z.enum(['oauth','apiKey']),managementVerified:z.boolean(),
});
export type BusinessPreview=z.infer<typeof businessPreviewSchema>;
export type ProviderAuthMethod='oauth'|'apiKey';
export interface ProviderCredentials {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  apiKey?: string;
  accountId?: string;
  remoteLocationId?: string;
  businessUnitId?: string;
}
export interface ProviderConfig {
  locationId: string;
  credentials?: ProviderCredentials;
  oauth?: { clientId: string; clientSecret: string; redirectUri: string };
  fetch?: typeof fetch;
  /** Persist tokens encrypted. Never log token values. */
  onTokens?: (tokens: ProviderCredentials) => Promise<void>;
  /** Serialize refresh across web/worker instances. Reload encrypted credentials
   * under the lock, execute refresh(latest), then persist returned token fields
   * while preserving verified resource identifiers. Do not invoke onTokens here. */
  refreshCredentials?: (refresh: (latest: ProviderCredentials) => Promise<ProviderCredentials>) => Promise<ProviderCredentials>;
}
export interface ConnectInput {
  code?: string;
  state?: string;
  redirectUri?: string;
  mode?: ConnectionMode;
}
export interface ConnectionResult {
  status: 'connected' | 'pending' | 'assisted';
  mode: ConnectionMode;
  authorizationUrl?: string;
  instructions?: string;
}
export interface ReplyResult { externalId: string; status: 'published' }
export interface ReviewProvider {
  readonly id: PlatformId;
  readonly label: string;
  readonly capabilities: ProviderCapabilities;
  connect(input?: ConnectInput): Promise<ConnectionResult>;
  fetchReviews(since?: Date): Promise<NormalizedReview[]>;
  reply(reviewId: string, text: string): Promise<ReplyResult>;
  /** Read-only profile/sample lookup. Public-key reads do not establish management rights. */
  previewBusiness?(): Promise<BusinessPreview>;
}
export type ProviderDefinition = {
  id: PlatformId;
  label: string;
  capabilities: ProviderCapabilities;
  modes: readonly ConnectionMode[];
  /** API adapters default to OAuth when omitted; email/assisted have no API auth. */
  authMethods?: readonly ProviderAuthMethod[];
  /** Source-link allowlist. Hosts only; no backend fetch is performed for these links. */
  allowedReviewHosts: readonly string[];
  create: (config: ProviderConfig) => ReviewProvider;
};

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: 'configuration' | 'authorization' | 'rate_limit' | 'upstream' | 'unsupported' | 'validation',
    public readonly retryable = false,
    public readonly retryAfterSeconds?: number,
    public readonly statusCode?: number,
  ) { super(message); this.name = 'ProviderError'; }
}
