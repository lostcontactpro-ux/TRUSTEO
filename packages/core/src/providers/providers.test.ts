import { describe, expect, it, vi } from 'vitest';
import { createProvider, providerDefinitions, parseNotificationEmail, isProviderUrl, ProviderError } from './index';
import { GoogleProvider } from './google';
import { TrustpilotProvider } from './trustpilot';

const locationId = 'location-one';
const googleCredentials = { accessToken: 'test-token', accountId: '123', remoteLocationId: '456' };
const response = (value: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const googleReview = (id: string, updateTime = '2026-01-02T12:00:00Z') => ({
  reviewId: id, reviewer: { displayName: 'Camille' }, starRating: 'TWO', comment: 'Un peu long.', createTime: '2026-01-01T12:00:00Z', updateTime,
});

describe('provider registry and fallbacks', () => {
  it('registers each platform once and never simulates API success', async () => {
    expect(providerDefinitions.length).toBe(23);
    expect(new Set(providerDefinitions.map(item => item.id)).size).toBe(23);
    const provider = createProvider('booking', { locationId });
    expect(provider.capabilities.canReply).toBe(false);
    expect(await provider.connect()).toMatchObject({ status: 'assisted', mode: 'assisted' });
    await expect(provider.reply('r1', 'Merci')).rejects.toMatchObject({ code: 'unsupported' });
    await expect(provider.fetchReviews()).rejects.toMatchObject({ code: 'unsupported' });
  });
  it('rejects unknown platforms', () => {
    expect(() => createProvider('unknown', { locationId })).toThrow(ProviderError);
  });
});

describe('Google official API transport', () => {
  it('paginates, deduplicates, normalizes and includes updated reviews since sync', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ reviews: [googleReview('a')], nextPageToken: 'next' }))
      .mockResolvedValueOnce(response({ reviews: [googleReview('a'), googleReview('b', '2025-01-01T12:00:00Z')] }));
    const provider = new GoogleProvider({ locationId, credentials: googleCredentials, fetch: request });
    const reviews = await provider.fetchReviews(new Date('2026-01-02'));
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ externalId: 'a', rating: 2, author: 'Camille', responseStatus: 'pending' });
    expect(request.mock.calls[1][0]).toContain('pageToken=next');
    expect(request.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer test-token' });
  });
  it('refreshes an expired token and persists rotated credentials', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ access_token: 'new-token', refresh_token: 'new-refresh', expires_in: 3600 }))
      .mockResolvedValueOnce(response({ reviews: [] }));
    const onTokens = vi.fn(async () => {});
    const provider = new GoogleProvider({
      locationId, credentials: { ...googleCredentials, expiresAt: 1, refreshToken: 'old-refresh' },
      oauth: { clientId: 'client', clientSecret: 'secret', redirectUri: 'https://app.example/callback' }, fetch: request, onTokens,
    });
    await provider.fetchReviews();
    expect(request.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token');
    expect(onTokens).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: 'new-refresh' }));
    expect(request.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer new-token' });
  });
  it('propagates quota and server errors for exponential queue retry without leaking bodies', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ secret: 'do-not-leak' }, 429, { 'retry-after': '30' }));
    const provider = new GoogleProvider({ locationId, credentials: googleCredentials, fetch: request });
    await expect(provider.fetchReviews()).rejects.toMatchObject({ code: 'rate_limit', retryable: true, retryAfterSeconds: 30 });
  });
  it('uses the real reply endpoint, validates text and never returns success for authorization failure', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ comment: 'Merci !' }));
    const provider = new GoogleProvider({ locationId, credentials: googleCredentials, fetch: request });
    expect(await provider.reply('r/1', ' Merci ! ')).toEqual({ externalId: 'r/1', status: 'published' });
    expect(request.mock.calls[0][0]).toContain('/reviews/r%2F1/reply');
    expect(request.mock.calls[0][1]?.method).toBe('PUT');
    expect(JSON.parse(request.mock.calls[0][1]?.body as string)).toEqual({ comment: 'Merci !' });
    await expect(provider.reply('r', '  ')).rejects.toMatchObject({ code: 'validation' });
    request.mockResolvedValue(response({}, 403));
    await expect(provider.reply('r', 'Merci')).rejects.toMatchObject({ code: 'authorization' });
  });
  it('requires a state and requests the proper scope without exposing client secrets', async () => {
    const provider = new GoogleProvider({ locationId, oauth: { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://app.example/callback' } });
    await expect(provider.connect()).rejects.toMatchObject({ code: 'configuration' });
    const result = await provider.connect({ state: 'single-use-state' });
    expect(result.authorizationUrl).toContain('business.manage');
    expect(result.authorizationUrl).toContain('state=single-use-state');
    expect(result.authorizationUrl).not.toContain('secret');
  });
});

describe('Trustpilot official API transport', () => {
  it('normalizes rating, title, language and response status', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ reviews: [{ id: 'tp-1', stars: 5, title: 'Bravo', text: 'Très bien', language: 'fr', createdAt: '2026-01-02T12:00:00Z', consumer: { displayName: 'Ali' }, companyReply: { text: 'Merci' } }] }));
    const provider = new TrustpilotProvider({ locationId, credentials: { accessToken: 'test', businessUnitId: 'biz' }, fetch: request });
    expect(await provider.fetchReviews()).toEqual([expect.objectContaining({ externalId: 'tp-1', rating: 5, text: 'Bravo\n\nTrès bien', responseStatus: 'replied', reply: 'Merci' })]);
    expect(request.mock.calls[0][0]).toContain('/private/business-units/biz/reviews');
  });
  it('includes edits to older reviews when synchronizing', async () => {
    const request=vi.fn<typeof fetch>().mockResolvedValue(response({reviews:[{id:'old-edited',stars:3,text:'Updated',createdAt:'2025-01-01T00:00:00Z',updatedAt:'2026-01-03T00:00:00Z'}]}));
    const provider=new TrustpilotProvider({locationId,credentials:{accessToken:'test',businessUnitId:'biz'},fetch:request});
    expect(await provider.fetchReviews(new Date('2026-01-02'))).toEqual([expect.objectContaining({externalId:'old-edited'})]);
  });
  it('posts a reply and refreshes after token expiry', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(response({ access_token: 'new', expires_in: 3600 }))
      .mockResolvedValueOnce(response({}));
    const provider = new TrustpilotProvider({ locationId, credentials: { accessToken: 'expired', refreshToken: 'refresh' }, oauth: { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://app.example/callback' }, fetch: request });
    await expect(provider.reply('tp-1', 'Merci')).resolves.toMatchObject({ status: 'published' });
    expect(request.mock.calls[0][0]).toContain('/private/reviews/tp-1/reply');
    expect(JSON.parse(request.mock.calls[0][1]?.body as string)).toEqual({ message: 'Merci' });
    expect(request.mock.calls[1][0]).toContain('/oauth/oauth-business-users-for-applications/accesstoken');
    expect(request.mock.calls[1][1]?.headers).toMatchObject({ Authorization: expect.stringMatching(/^Basic /) });
  });
  it('does not silently accept malformed API responses', async () => {
    const provider = new TrustpilotProvider({ locationId, credentials: { accessToken: 'test', businessUnitId: 'biz' }, fetch: vi.fn<typeof fetch>().mockResolvedValue(response({})) });
    await expect(provider.fetchReviews()).rejects.toMatchObject({ code: 'upstream' });
  });
});

describe('authenticated notification parsing boundary', () => {
  const email = { messageId: 'm1', subject: 'Nouvel avis', receivedAt: new Date(), text: 'Auteur: Camille\nNote: 8/10\nDate: 2026-01-02T12:00:00Z\nAvis: Bon séjour.\nURL: https://www.booking.com/reviews/123' };
  it('normalizes a genuine structured notification and deduplicates forwarded copies', () => {
    const one = parseNotificationEmail('booking', locationId, email);
    const two = parseNotificationEmail('booking', locationId, { ...email, messageId: 'forward2' });
    expect(one.rating).toBe(4);
    expect(one.text).toBe('Bon séjour.');
    expect(one.externalId).toBe(two.externalId);
  });
  it('rejects unsupported formats and lookalike domains', () => {
    expect(() => parseNotificationEmail('booking', locationId, { ...email, text: email.text.replace('booking.com', 'booking.com.evil.example') })).toThrow();
    expect(() => parseNotificationEmail('booking', locationId, { ...email, text: 'An email with no original review fields.' })).toThrow();
    expect(isProviderUrl('google', 'javascript:alert(1)')).toBe(false);
    expect(isProviderUrl('trustpilot', 'https://trustpilot.com@evil.example/reviews/1')).toBe(false);
  });
});
