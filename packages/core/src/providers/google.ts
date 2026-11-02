import { encodePath, requireValue, validReply } from './http';
import { OAuthProvider } from './oauth';
import { normalizedReviewSchema, ProviderError, type ConnectInput, type ConnectionResult, type NormalizedReview, type ProviderConfig, type ProviderDefinition, type ReplyResult, type ReviewProvider } from './types';

type GoogleReview = {
  reviewId: string; reviewer?: { displayName?: string }; starRating: string;
  comment?: string; createTime: string; updateTime?: string;
  reviewReply?: { comment?: string };
};
const ratings: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
export class GoogleProvider extends OAuthProvider implements ReviewProvider {
  readonly id = 'google' as const;
  readonly label = 'Google Business Profile';
  readonly capabilities = { canRead: true, canReply: true, realtime: false, requiresPartnership: true };
  protected readonly tokenUrl = 'https://oauth2.googleapis.com/token';
  protected tokenHeaders() { return {}; }
  protected tokenParameters() {
    return { client_id: requireValue(this.config.oauth?.clientId, 'Google clientId'), client_secret: requireValue(this.config.oauth?.clientSecret, 'Google clientSecret') };
  }
  async connect(input: ConnectInput = {}): Promise<ConnectionResult> {
    if (input.mode && input.mode !== 'api') return { mode: input.mode, status: input.mode === 'assisted' ? 'assisted' : 'pending', instructions: 'Use a trusted notification email or open the original review to reply.' };
    if (input.code) {
      await this.tokenRequest({ grant_type: 'authorization_code', code: input.code, redirect_uri: requireValue(this.config.oauth?.redirectUri, 'Google redirectUri') });
      return { mode: 'api', status: 'connected' };
    }
    if (this.credentials.accessToken || this.credentials.refreshToken) {
      await this.accessToken();
      return { mode: 'api', status: 'connected' };
    }
    const state = requireValue(input.state, 'OAuth state');
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: requireValue(this.config.oauth?.clientId, 'Google clientId'),
      redirect_uri: requireValue(this.config.oauth?.redirectUri, 'Google redirectUri'),
      scope: 'https://www.googleapis.com/auth/business.manage', response_type: 'code',
      access_type: 'offline', prompt: 'consent', state,
    }).toString();
    return { status: 'pending', mode: 'api', authorizationUrl: url.toString() };
  }
  private locationPath() {
    return `accounts/${encodePath(requireValue(this.credentials.accountId, 'Google accountId'))}/locations/${encodePath(requireValue(this.credentials.remoteLocationId, 'Google remoteLocationId'))}`;
  }
  async fetchReviews(since?: Date): Promise<NormalizedReview[]> {
    const result = new Map<string, NormalizedReview>();
    const seenPages = new Set<string>();
    let pageToken = '';
    for (let page = 0; page < 1000; page++) {
      const url = new URL(`https://mybusiness.googleapis.com/v4/${this.locationPath()}/reviews`);
      url.search = new URLSearchParams({ pageSize: '50', orderBy: 'updateTime desc', ...(pageToken ? { pageToken } : {}) }).toString();
      const data = await this.authorized<{ reviews?: GoogleReview[]; nextPageToken?: string }>(url.toString());
      let newer = false;
      for (const review of data.reviews ?? []) {
        const changedAt = new Date(review.updateTime ?? review.createTime);
        if (Number.isNaN(changedAt.getTime())) throw new ProviderError('Google returned an invalid review date.', 'upstream');
        if (since && changedAt < since) continue;
        newer = true;
        const normalized = normalizedReviewSchema.parse({
          externalId: review.reviewId, platform: this.id, locationId: this.config.locationId,
          author: review.reviewer?.displayName || 'Google user', rating: ratings[review.starRating],
          text: review.comment ?? '', language: 'und', publishedAt: new Date(review.createTime),
          responseStatus: review.reviewReply?.comment ? 'replied' : 'pending',
          sourceUrl: `https://business.google.com/reviews?reviewId=${encodePath(review.reviewId)}`,
          reply: review.reviewReply?.comment,
        });
        result.set(normalized.externalId, normalized);
      }
      if (!data.nextPageToken || (since && !newer)) return [...result.values()];
      if (seenPages.has(data.nextPageToken)) throw new ProviderError('Google pagination repeated a page.', 'upstream');
      seenPages.add(data.nextPageToken);
      pageToken = data.nextPageToken;
    }
    throw new ProviderError('Google pagination safety limit reached; synchronization is incomplete.', 'upstream');
  }
  async reply(reviewId: string, text: string): Promise<ReplyResult> {
    if (!reviewId) throw new ProviderError('Review ID is required.', 'validation');
    await this.authorized(`https://mybusiness.googleapis.com/v4/${this.locationPath()}/reviews/${encodePath(reviewId)}/reply`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment: validReply(text) }),
    });
    return { externalId: reviewId, status: 'published' };
  }
}
export const definition: ProviderDefinition = {
  id: 'google', label: 'Google Business Profile',
  capabilities: { canRead: true, canReply: true, realtime: false, requiresPartnership: true },
  modes: ['api', 'email', 'assisted'], create: (config: ProviderConfig) => new GoogleProvider(config),
};
