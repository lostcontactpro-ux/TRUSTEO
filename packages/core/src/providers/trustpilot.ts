import { Buffer } from 'node:buffer';
import { encodePath, requireValue, validReply } from './http';
import { OAuthProvider } from './oauth';
import { normalizedReviewSchema, ProviderError, type ConnectInput, type ConnectionResult, type NormalizedReview, type ProviderDefinition, type ReplyResult, type ReviewProvider } from './types';

type TrustpilotReview = {
  id: string; stars: number; title?: string; text?: string; language?: string; createdAt: string; updatedAt?: string;
  consumer?: { displayName?: string }; companyReply?: { text?: string };
};
export class TrustpilotProvider extends OAuthProvider implements ReviewProvider {
  readonly id = 'trustpilot' as const;
  readonly label = 'Trustpilot';
  readonly capabilities = { canRead: true, canReply: true, realtime: false, requiresPartnership: true };
  protected readonly tokenUrl = 'https://api.trustpilot.com/v1/oauth/oauth-business-users-for-applications/accesstoken';
  protected tokenHeaders() {
    const clientId = requireValue(this.config.oauth?.clientId, 'Trustpilot clientId');
    const clientSecret = requireValue(this.config.oauth?.clientSecret, 'Trustpilot clientSecret');
    return { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` };
  }
  protected tokenParameters() { return {}; }
  async connect(input: ConnectInput = {}): Promise<ConnectionResult> {
    if (input.mode && input.mode !== 'api') return { mode: input.mode, status: input.mode === 'assisted' ? 'assisted' : 'pending', instructions: 'Use a trusted notification email or open Trustpilot to reply.' };
    if (input.code) {
      await this.tokenRequest({ grant_type: 'authorization_code', code: input.code, redirect_uri: requireValue(this.config.oauth?.redirectUri, 'Trustpilot redirectUri') });
      return { mode: 'api', status: 'connected' };
    }
    if (this.credentials.accessToken || this.credentials.refreshToken) {
      await this.accessToken();
      return { mode: 'api', status: 'connected' };
    }
    const url = new URL('https://authenticate.trustpilot.com/');
    url.search = new URLSearchParams({
      client_id: requireValue(this.config.oauth?.clientId, 'Trustpilot clientId'),
      redirect_uri: requireValue(this.config.oauth?.redirectUri, 'Trustpilot redirectUri'),
      response_type: 'code', state: requireValue(input.state, 'OAuth state'),
    }).toString();
    return { status: 'pending', mode: 'api', authorizationUrl: url.toString() };
  }
  async fetchReviews(since?: Date): Promise<NormalizedReview[]> {
    const businessUnit = requireValue(this.credentials.businessUnitId, 'Trustpilot businessUnitId');
    const result = new Map<string, NormalizedReview>();
    for (let page = 1; page <= 1000; page++) {
      const url = new URL(`https://api.trustpilot.com/v1/private/business-units/${encodePath(businessUnit)}/reviews`);
      url.search = new URLSearchParams({ page: String(page), perPage: '100', orderBy: 'createdat.desc' }).toString();
      const data = await this.authorized<{ reviews?: TrustpilotReview[] }>(url.toString());
      if (!Array.isArray(data.reviews)) throw new ProviderError('Trustpilot returned an invalid reviews collection.', 'upstream');
      for (const review of data.reviews) {
        const date = new Date(review.createdAt);
        const changedAt = new Date(review.updatedAt ?? review.createdAt);
        if (Number.isNaN(date.getTime()) || Number.isNaN(changedAt.getTime())) throw new ProviderError('Trustpilot returned an invalid review date.', 'upstream');
        if (since && changedAt < since) continue;
        if(!Number.isInteger(review.stars)||review.stars<1||review.stars>5)throw new ProviderError('Trustpilot returned an invalid star rating.','upstream');
        const normalized = normalizedReviewSchema.parse({
          externalId: review.id, platform: this.id, locationId: this.config.locationId,
          author: review.consumer?.displayName || 'Trustpilot user', rating: review.stars,
          text: [review.title, review.text].filter(Boolean).join('\n\n'), language: review.language || 'und',
          publishedAt: date, responseStatus: review.companyReply?.text ? 'replied' : 'pending',
          sourceUrl: `https://www.trustpilot.com/reviews/${encodePath(review.id)}`, reply: review.companyReply?.text,
        });
        result.set(normalized.externalId, normalized);
      }
      // Trustpilot is sorted by creation date: older edited reviews may still appear later.
      // Scan to the end before moving the sync cursor, even if this page has no new reviews.
      if (data.reviews.length < 100) return [...result.values()];
    }
    throw new ProviderError('Trustpilot pagination safety limit reached; synchronization is incomplete.', 'upstream');
  }
  async reply(reviewId: string, text: string): Promise<ReplyResult> {
    if (!reviewId) throw new ProviderError('Review ID is required.', 'validation');
    await this.authorized(`https://api.trustpilot.com/v1/private/reviews/${encodePath(reviewId)}/reply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: validReply(text) }),
    });
    return { externalId: reviewId, status: 'published' };
  }
}
export const definition: ProviderDefinition = {
  id: 'trustpilot', label: 'Trustpilot',
  capabilities: { canRead: true, canReply: true, realtime: false, requiresPartnership: true },
  allowedReviewHosts: ['trustpilot.com'],
  modes: ['api', 'email', 'assisted'], create: config => new TrustpilotProvider(config),
};
