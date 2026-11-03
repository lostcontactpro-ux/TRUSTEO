import { describe, expect, it, vi } from 'vitest';
import { createProvider, providerDefinitions, parseNotificationEmail, isProviderUrl, normalizedReviewSchema, ProviderError, type ProviderConfig, type ProviderCredentials } from './index';
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
    expect(providerDefinitions.map(item=>item.id)).toEqual(expect.arrayContaining(['google','trustpilot','booking','custom']));
    expect(new Set(providerDefinitions.map(item => item.id)).size).toBe(providerDefinitions.length);
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
  it('refreshes revoked tokens once on 401 during account discovery, and never on 403', async () => {
    const request=vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({},401))
      .mockResolvedValueOnce(response({access_token:'renewed',expires_in:3600}))
      .mockResolvedValueOnce(response({accounts:[{name:'accounts/123'}]}));
    const provider=new GoogleProvider({locationId,credentials:{...googleCredentials,refreshToken:'refresh'},oauth:{clientId:'id',clientSecret:'secret',redirectUri:'https://app.example/callback'},fetch:request});
    expect(await provider.listAccountsPage()).toMatchObject({accounts:[{name:'accounts/123'}]});
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2][1]?.headers).toMatchObject({Authorization:'Bearer renewed'});
    request.mockClear().mockResolvedValue(response({},403));
    await expect(provider.listLocationsPage('123')).rejects.toMatchObject({code:'authorization',statusCode:403});
    expect(request).toHaveBeenCalledTimes(1);
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

describe('shared OAuth refresh lock',()=>{
  // Simulate two independent app/worker instances sharing the same locked database row.
  function sharedRow(initial:ProviderCredentials){
    let saved={...initial};let tail=Promise.resolve();
    const refreshCredentials:NonNullable<ProviderConfig['refreshCredentials']>=async refresh=>{
      const previous=tail;let release!:()=>void;
      tail=new Promise<void>(resolve=>{release=resolve});
      await previous;
      try{
        const tokens=await refresh({...saved});
        saved={...saved,accessToken:tokens.accessToken,refreshToken:tokens.refreshToken,expiresAt:tokens.expiresAt};
        return {...saved};
      }finally{release();}
    };
    return {refreshCredentials,read:()=>({...saved})};
  }
  const oauth={clientId:'client',clientSecret:'secret',redirectUri:'https://app.example/callback'};
  it('refreshes a rotating token only once across concurrent expired snapshots',async()=>{
    const credentials={...googleCredentials,expiresAt:1,refreshToken:'old-refresh'};
    const row=sharedRow(credentials);const onTokens=vi.fn(async()=>{});
    const tokenRequests=vi.fn();
    const request=vi.fn<typeof fetch>(async(url,init)=>{
      if(String(url)==='https://oauth2.googleapis.com/token'){
        tokenRequests(init?.body);
        return response({access_token:'shared-new-token',refresh_token:'rotated-once',expires_in:3600});
      }
      expect(init?.headers).toMatchObject({Authorization:'Bearer shared-new-token'});
      return response({reviews:[]});
    });
    const config={locationId,credentials,oauth,fetch:request,onTokens,refreshCredentials:row.refreshCredentials};
    await Promise.all([new GoogleProvider(config).fetchReviews(),new GoogleProvider(config).fetchReviews()]);
    expect(tokenRequests).toHaveBeenCalledTimes(1);
    expect(String(tokenRequests.mock.calls[0][0])).toContain('refresh_token=old-refresh');
    expect(row.read()).toMatchObject({accessToken:'shared-new-token',refreshToken:'rotated-once',accountId:'123',remoteLocationId:'456'});
    expect(onTokens).not.toHaveBeenCalled(); // Persistence belongs to the lock owner, avoiding nested row-lock acquisition.
  });
  it('reuses another instance’s refresh after simultaneous 401 responses before expiry',async()=>{
    const credentials={...googleCredentials,expiresAt:Date.now()+3600000,refreshToken:'old-refresh'};
    const row=sharedRow(credentials);const tokenRequests=vi.fn();const rejectedRequests=vi.fn();
    const request=vi.fn<typeof fetch>(async(url,init)=>{
      if(String(url)==='https://oauth2.googleapis.com/token'){
        tokenRequests();return response({access_token:'shared-new-token',refresh_token:'rotated-once',expires_in:3600});
      }
      const headers=new Headers(init?.headers);
      if(headers.get('Authorization')==='Bearer test-token'){rejectedRequests();return response({},401);}
      expect(headers.get('Authorization')).toBe('Bearer shared-new-token');
      return response({reviews:[]});
    });
    const config={locationId,credentials,oauth,fetch:request,refreshCredentials:row.refreshCredentials};
    await Promise.all([new GoogleProvider(config).fetchReviews(),new GoogleProvider(config).fetchReviews()]);
    expect(rejectedRequests).toHaveBeenCalledTimes(2);
    expect(tokenRequests).toHaveBeenCalledTimes(1);
    expect(row.read().refreshToken).toBe('rotated-once');
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
  it('keeps customer-written metadata inside the review body and cannot overwrite another review ID',()=>{
    const input={...email,text:email.text.replace('Avis: Bon séjour.','Avis: Bon séjour.\nReview ID: victim\nAuthor: Forged\nURL: https://www.booking.com/reviews/victim')};
    const parsed=parseNotificationEmail('booking',locationId,input);
    expect(parsed.externalId).toBe('123');expect(parsed.author).toBe('Camille');expect(parsed.text).toContain('Review ID: victim');
    expect(parsed.sourceUrl).toBe('https://www.booking.com/reviews/123');
  });
  it('handles the full original ten-point scale without inventing a floor',()=>{
    expect(parseNotificationEmail('booking',locationId,{...email,text:email.text.replace('8/10','10/10')}).rating).toBe(5);
    expect(parseNotificationEmail('booking',locationId,{...email,text:email.text.replace('8/10','1/10')}).rating).toBe(0.5);
    expect(()=>parseNotificationEmail('booking',locationId,{...email,text:email.text.replace('8/10','11/10')})).toThrow();
  });
  it('rejects private, credential-bearing and alternate-port custom source links',()=>{
    for(const url of ['https://127.1/reviews/1','https://2130706433/reviews/1','https://[::1]/','https://10.0.0.1/','https://service.internal/','https://user:password@example.com/reviews/1','https://example.com:8080/reviews/1'])expect(isProviderUrl('custom',url)).toBe(false);
    expect(isProviderUrl('custom','https://reviews.example.com/reviews/1')).toBe(true);
  });
  it('accepts an extensible provider identifier in normalized reviews',()=>{
    const valid=parseNotificationEmail('booking',locationId,email);
    expect(normalizedReviewSchema.parse({...valid,platform:'another-provider'}).platform).toBe('another-provider');
  });
  it('rejects unsupported formats and lookalike domains', () => {
    expect(() => parseNotificationEmail('booking', locationId, { ...email, text: email.text.replace('booking.com', 'booking.com.evil.example') })).toThrow();
    expect(() => parseNotificationEmail('booking', locationId, { ...email, text: 'An email with no original review fields.' })).toThrow();
    expect(isProviderUrl('google', 'javascript:alert(1)')).toBe(false);
    expect(isProviderUrl('trustpilot', 'https://trustpilot.com@evil.example/reviews/1')).toBe(false);
  });
});
