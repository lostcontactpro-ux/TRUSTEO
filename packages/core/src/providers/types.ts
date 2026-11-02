import { z } from 'zod';

export const platformIds = [
  'google', 'trustpilot', 'facebook', 'instagram', 'tripadvisor', 'thefork', 'yelp',
  'pagesjaunes', 'apple', 'foursquare', 'skeepers', 'booking', 'airbnb', 'expedia',
  'ubereats', 'deliveroo', 'justeat', 'google-shopping', 'appstore', 'googleplay',
  'capterra', 'g2', 'custom',
] as const;
export type PlatformId = typeof platformIds[number];
export type ConnectionMode = 'api' | 'email' | 'assisted';
export interface ProviderCapabilities {
  canRead: boolean;
  canReply: boolean;
  realtime: boolean;
  requiresPartnership: boolean;
}
export const normalizedReviewSchema = z.object({
  externalId: z.string().min(1).max(500),
  platform: z.enum(platformIds),
  locationId: z.string().min(1),
  author: z.string().min(1).max(300),
  rating: z.number().min(1).max(5),
  text: z.string().max(30000),
  language: z.string().max(20).default('und'),
  publishedAt: z.coerce.date(),
  responseStatus: z.enum(['pending', 'replied']),
  sourceUrl: z.string().url().refine(value => value.startsWith('https://'), 'HTTPS required'),
  reply: z.string().max(10000).optional(),
});
export type NormalizedReview = z.infer<typeof normalizedReviewSchema>;
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
}
export type ProviderDefinition = {
  id: PlatformId;
  label: string;
  capabilities: ProviderCapabilities;
  modes: readonly ConnectionMode[];
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
