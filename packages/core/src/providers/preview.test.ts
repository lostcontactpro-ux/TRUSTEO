import { describe,expect,it,vi } from 'vitest';
import { GoogleProvider } from './google';
import { TrustpilotProvider } from './trustpilot';
import { providerDefinitions } from './index';

const oauth={clientId:'application-client',clientSecret:'application-secret',redirectUri:'https://app.example/callback'};
const json=(value:unknown,status=200)=>Response.json(value,{status});
const googleReview=(id:string)=>({reviewId:id,reviewer:{displayName:'Camille'},starRating:'FOUR',comment:'Très bon accueil',createTime:'2026-01-01T12:00:00Z'});
const trustpilotReview=(id:string)=>({id,stars:5,text:'Une vraie expérience',createdAt:'2026-01-01T12:00:00Z',language:'fr',consumer:{displayName:'Ali'}});
const googleBusiness={name:'locations/location-456',title:'Le Petit Comptoir',websiteUri:'https://comptoir.example.com/?api_key=private-key',storefrontAddress:{addressLines:['12 rue de Paris'],postalCode:'75001',locality:'Paris',regionCode:'FR'},metadata:{mapsUri:'https://maps.google.com/?cid=123&access_token=private-token'}};
const trustpilotBusiness={id:'business-123',displayName:'Boutique Locale',name:{identifying:'boutique.example.com'},websiteUrl:'https://boutique.example.com/?apikey=user-private-key',address:{street:'1 rue des Lilas',postalCode:'69001',city:'Lyon',country:'FR'},score:{trustScore:4.7,stars:4.5},numberOfReviews:{total:143}};

describe('business preview with authorized Google account',()=>{
  it('reads the selected real profile and at most three sample reviews using only GET',async()=>{
    const request=vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(googleBusiness))
      .mockResolvedValueOnce(json({averageRating:4.2,totalReviewCount:97,reviews:['one','two','three','four'].map(googleReview),nextPageToken:'must-not-follow'}));
    const provider=new GoogleProvider({locationId:'local-one',credentials:{accessToken:'google-user-token',accountId:'account-123',remoteLocationId:'location-456'},fetch:request});
    const preview=await provider.previewBusiness();
    expect(preview).toMatchObject({platform:'google',businessId:'location-456',name:'Le Petit Comptoir',address:'12 rue de Paris, 75001, Paris, FR',website:'https://comptoir.example.com/',sourceUrl:'https://maps.google.com/?cid=123',rating:4.2,reviewCount:97,authMethod:'oauth',managementVerified:true});
    expect(preview.reviews).toHaveLength(3);expect(preview.reviews[0]).toMatchObject({externalId:'one',locationId:'local-one',rating:4});
    expect(request).toHaveBeenCalledTimes(2);
    expect(String(request.mock.calls[0][0])).toContain('/v1/locations/location-456?readMask=');
    expect(new URL(String(request.mock.calls[1][0])).searchParams.get('pageSize')).toBe('3');
    for(const [url,init]of request.mock.calls){expect(init?.method??'GET').toBe('GET');expect(String(url)).not.toContain('google-user-token');expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer google-user-token');}
    expect(JSON.stringify(preview)).not.toContain('google-user-token');
  });
  it('does not treat an API key or public resource IDs as Google authorization',async()=>{
    const request=vi.fn<typeof fetch>();
    const ids={accountId:'account-123',remoteLocationId:'location-456'};
    await expect(new GoogleProvider({locationId:'local-one',credentials:{...ids,apiKey:'user-private-key'},fetch:request}).previewBusiness()).rejects.toMatchObject({code:'unsupported'});
    await expect(new GoogleProvider({locationId:'local-one',credentials:ids,fetch:request}).previewBusiness()).rejects.toMatchObject({code:'configuration'});
    expect(request).not.toHaveBeenCalled();
  });
  it('refuses permission failures and mismatching profile identity',async()=>{
    const denied=vi.fn<typeof fetch>().mockResolvedValue(json({access_token:'must-not-leak'},403));
    const config={locationId:'local-one',credentials:{accessToken:'google-user-token',accountId:'account-123',remoteLocationId:'location-456'}};
    await expect(new GoogleProvider({...config,fetch:denied}).previewBusiness()).rejects.toMatchObject({code:'authorization'});
    const wrong=vi.fn<typeof fetch>().mockResolvedValue(json({...googleBusiness,name:'locations/someone-else'}));
    await expect(new GoogleProvider({...config,fetch:wrong}).previewBusiness()).rejects.toMatchObject({code:'upstream'});
    expect(wrong).toHaveBeenCalledTimes(1);
  });
});

describe('Trustpilot public API-key preview',()=>{
  it('uses header authentication for public reads and explicitly does not establish management rights',async()=>{
    const request=vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(trustpilotBusiness))
      .mockResolvedValueOnce(json({reviews:['one','two','three','four'].map(trustpilotReview)}));
    // Stale OAuth data must never make a selected API-key connection writable.
    const provider=new TrustpilotProvider({locationId:'local-one',credentials:{apiKey:'user-private-key',businessUnitId:'business-123',accessToken:'stale-oauth-token',refreshToken:'stale-refresh',expiresAt:1},oauth,fetch:request});
    const preview=await provider.previewBusiness();
    expect(preview).toMatchObject({businessId:'business-123',name:'Boutique Locale',address:'1 rue des Lilas, 69001, Lyon, FR',website:'https://boutique.example.com/',sourceUrl:'https://www.trustpilot.com/review/boutique.example.com',rating:4.7,reviewCount:143,authMethod:'apiKey',managementVerified:false});
    expect(preview.reviews).toHaveLength(3);expect(provider.capabilities).toMatchObject({canRead:true,canReply:false});
    expect(request).toHaveBeenCalledTimes(2);
    expect(String(request.mock.calls[1][0])).toContain('/v1/business-units/business-123/reviews?');
    expect(new URL(String(request.mock.calls[1][0])).searchParams.get('perPage')).toBe('3');
    for(const [url,init]of request.mock.calls){
      expect(init?.method??'GET').toBe('GET');expect(String(url)).not.toContain('/private/');expect(String(url)).not.toContain('user-private-key');
      expect(new Headers(init?.headers).get('apikey')).toBe('user-private-key');expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    }
    expect(JSON.stringify(preview)).not.toContain('user-private-key');expect(JSON.stringify(preview)).not.toContain('stale-oauth-token');
    await expect(provider.reply('one','Merci !')).rejects.toMatchObject({code:'unsupported'});
    expect(request).toHaveBeenCalledTimes(2); // No publication attempt, even with stale OAuth tokens.
  });
  it('uses public read transport for subsequent synchronization and refuses leaking-key errors',async()=>{
    const request=vi.fn<typeof fetch>().mockResolvedValueOnce(json({reviews:[trustpilotReview('one')]})).mockResolvedValueOnce(json({message:'user-private-key'},403));
    const provider=new TrustpilotProvider({locationId:'local-one',credentials:{apiKey:'user-private-key',businessUnitId:'business-123'},fetch:request});
    expect(await provider.fetchReviews()).toHaveLength(1);
    expect(String(request.mock.calls[0][0])).toContain('/v1/business-units/business-123/reviews?');
    await expect(provider.previewBusiness()).rejects.toThrow('Provider authorization required.');
    await expect(provider.reply('one','Merci')).rejects.toThrow('read-only');
  });
  it('rejects a different business unit and accidental upstream echoes of secret values',async()=>{
    const wrong=vi.fn<typeof fetch>().mockResolvedValue(json({...trustpilotBusiness,id:'different-unit'}));
    const config={locationId:'local-one',credentials:{apiKey:'user-private-key',businessUnitId:'business-123'}};
    await expect(new TrustpilotProvider({...config,fetch:wrong}).previewBusiness()).rejects.toMatchObject({code:'upstream'});
    expect(wrong).toHaveBeenCalledTimes(1);
    const echoed=vi.fn<typeof fetch>().mockResolvedValueOnce(json({...trustpilotBusiness,displayName:'Accidental user-private-key echo'})).mockResolvedValueOnce(json({reviews:[]}));
    await expect(new TrustpilotProvider({...config,fetch:echoed}).previewBusiness()).rejects.toThrow('invalid business profile');
  });
});

describe('Trustpilot OAuth business preview',()=>{
  it('uses the authorized private review endpoint without changing default reply capabilities',async()=>{
    const request=vi.fn<typeof fetch>().mockResolvedValueOnce(json(trustpilotBusiness)).mockResolvedValueOnce(json({reviews:[trustpilotReview('one')]}));
    const provider=new TrustpilotProvider({locationId:'local-one',credentials:{accessToken:'authorized-user-token',businessUnitId:'business-123'},oauth,fetch:request});
    const preview=await provider.previewBusiness();
    expect(preview.authMethod).toBe('oauth');expect(preview.managementVerified).toBe(true);expect(provider.capabilities.canReply).toBe(true);
    expect(String(request.mock.calls[1][0])).toContain('/v1/private/business-units/business-123/reviews?');
    expect(new Headers(request.mock.calls[0][1]?.headers).get('apikey')).toBe('application-client');
    for(const [url,init]of request.mock.calls){expect(init?.method??'GET').toBe('GET');expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer authorized-user-token');expect(String(url)).not.toContain('authorized-user-token');}
    expect(JSON.stringify(preview)).not.toContain('authorized-user-token');expect(JSON.stringify(preview)).not.toContain('application-secret');
  });
  it('exposes serializable supported authentication metadata',()=>{
    expect(providerDefinitions.find(provider=>provider.id==='google')?.authMethods).toEqual(['oauth']);
    expect(providerDefinitions.find(provider=>provider.id==='trustpilot')?.authMethods).toEqual(['oauth','apiKey']);
  });
});
