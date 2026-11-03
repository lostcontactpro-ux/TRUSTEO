import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { ProviderConnection } from '@prisma/client';
import { decryptCredentials,encryptCredentials } from '@trusteo/core/crypto';

const mocked=vi.hoisted(()=>({
  current:{credentials:''},
  updated:vi.fn(),
  cookie:undefined as string|undefined,
  marker:new Set<string>(),
  setCookie:vi.fn(),
}));
vi.mock('@/lib/db',()=>{
  const connection={
    findUniqueOrThrow:vi.fn(async()=>({...mocked.current})),
    update:vi.fn(async({data}:{data:{credentials:string}})=>{mocked.updated(data);mocked.current.credentials=data.credentials;return mocked.current}),
  };
  return {db:{providerConnection:connection,$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({providerConnection:connection,$queryRaw:vi.fn(async()=>[])}),webhookEvent:{
    create:vi.fn(async({data}:{data:{id:string}})=>{mocked.marker.add(data.id)}),
    deleteMany:vi.fn(async({where}:{where:{id:string}})=>({count:mocked.marker.delete(where.id)?1:0})),
  }}};
});
vi.mock('next/headers',()=>({cookies:async()=>({
  get:()=>mocked.cookie?{value:mocked.cookie}:undefined,
  set:(name:string,value:string,options:unknown)=>{mocked.cookie=value||undefined;mocked.setCookie(name,value,options)},
})}));
import { consumeProviderOAuth,makeProvider,publicConnection,startProviderOAuth } from './providers';
const connection=():ProviderConnection=>({id:'conn-one',locationId:'loc-one',platform:'google',mode:'api',status:'pending',authMethod:'oauth',pendingPreview:null,previewTokenHash:null,previewExpiresAt:null,testedAt:null,confirmedAt:null,externalId:null,credentials:mocked.current.credentials,inboxToken:'private-inbox',lastSyncedAt:null,lastError:null,createdAt:new Date(),updatedAt:new Date()});

beforeEach(()=>{
  vi.unstubAllGlobals();vi.clearAllMocks();mocked.cookie=undefined;mocked.marker.clear();
  process.env.CREDENTIAL_ENCRYPTION_KEY='ab'.repeat(32);process.env.GOOGLE_CLIENT_ID='test-client';process.env.GOOGLE_CLIENT_SECRET='test-secret';
  mocked.current.credentials=encryptCredentials({accessToken:'old',refreshToken:'refresh',expiresAt:0,accountId:'verified-account',remoteLocationId:'verified-location'});
});
describe('provider credential boundaries',()=>{
  it('never commits candidate resources when verification refreshes a token and then fails',async()=>{
    const request=vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({access_token:'renewed',refresh_token:'rotated',expires_in:3600}))
      .mockResolvedValueOnce(Response.json({}, {status:403}));
    vi.stubGlobal('fetch',request);
    const candidate={...connection(),credentials:encryptCredentials({accessToken:'old',refreshToken:'refresh',expiresAt:0,accountId:'unverified-account',remoteLocationId:'unverified-location'})};
    await expect(makeProvider(candidate).fetchReviews()).rejects.toMatchObject({code:'authorization'});
    expect(decryptCredentials(mocked.current.credentials)).toMatchObject({accountId:'verified-account',remoteLocationId:'verified-location',accessToken:'renewed',refreshToken:'rotated'});
  });
  it('returns an explicit public DTO without credentials or nested user data',()=>{
    const input={...connection(),location:{id:'loc-one',name:'Restaurant',city:'Paris',user:{email:'private@example.com',passwordHash:'private-hash'}}};
    const output=publicConnection(input);
    expect(output).not.toHaveProperty('credentials');expect(output).not.toHaveProperty('inboxToken');expect(output.location).not.toHaveProperty('user');
    expect(JSON.stringify(output)).not.toContain('private-hash');
  });
});
describe('provider OAuth state',()=>{
  it('uses an encrypted HttpOnly cookie, binds the user, and consumes the DB marker once',async()=>{
    const authorizationUrl=await startProviderOAuth(connection(),'user-one');
    const state=new URL(authorizationUrl).searchParams.get('state')!;
    const originalCookie=mocked.cookie!;
    expect(originalCookie).not.toContain('user-one');
    expect(mocked.setCookie).toHaveBeenCalledWith('trusteo_provider_oauth',expect.any(String),expect.objectContaining({httpOnly:true,sameSite:'lax',path:'/api/connections/oauth',maxAge:600}));
    await expect(consumeProviderOAuth(state,'another-user')).rejects.toMatchObject({status:403});
    mocked.cookie=originalCookie;
    expect(await consumeProviderOAuth(state,'user-one')).toMatchObject({connectionId:'conn-one',userId:'user-one'});
    mocked.cookie=originalCookie;
    await expect(consumeProviderOAuth(state,'user-one')).rejects.toMatchObject({status:403});
  });
});
