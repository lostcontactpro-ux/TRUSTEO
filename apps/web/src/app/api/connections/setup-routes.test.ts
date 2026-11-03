import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({
  current:null as Record<string,unknown>|null, user:vi.fn(), entitlement:vi.fn(), rateLimit:vi.fn(),
  findLocation:vi.fn(),upsert:vi.fn(),update:vi.fn(),startOAuth:vi.fn(),owned:vi.fn(),
}));
vi.mock('@/lib/auth',()=>({requireUser:mocks.user}));
vi.mock('@/lib/entitlements',()=>({requireEntitlement:mocks.entitlement}));
vi.mock('@/lib/security',async actual=>({...await actual<object>(),rateLimit:mocks.rateLimit}));
vi.mock('@/lib/db',()=>{
  const providerConnection={findUnique:async()=>mocks.current,findUniqueOrThrow:async()=>mocks.current,upsert:mocks.upsert,update:mocks.update};
  const tx={providerConnection,$queryRaw:async()=>[]};
  return {db:{providerConnection,location:{findFirst:mocks.findLocation},$transaction:async(fn:(value:typeof tx)=>Promise<unknown>)=>fn(tx)}};
});
vi.mock('@/lib/providers',()=>({
  startProviderOAuth:mocks.startOAuth,ownedConnection:mocks.owned,
  publicConnection:(row:unknown)=>row,
  providerApiError:(error:unknown):never=>{throw error},
}));
import {POST} from './route';
import {PATCH} from './[id]/route';
const confirmedAt=new Date('2026-11-03T10:00:00Z');
function request(data:unknown){return new Request('http://localhost:3000/api/connections',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify(data)});}
const setup={locationId:'location-1',platform:'trustpilot',mode:'api',authMethod:'apiKey'};
beforeEach(()=>{
  vi.resetAllMocks();mocks.current=null;process.env.APP_URL='http://localhost:3000';
  mocks.user.mockResolvedValue({id:'owner-1'});mocks.entitlement.mockResolvedValue(undefined);mocks.rateLimit.mockResolvedValue(undefined);
  mocks.findLocation.mockResolvedValue({id:'location-1',userId:'owner-1'});
  mocks.upsert.mockImplementation(async({create,update})=>{mocks.current={id:'connection-1',inboxToken:'inbox',...(mocks.current?{...mocks.current,...update}:create)};return mocks.current});
  mocks.update.mockImplementation(async({data})=>{mocks.current={...mocks.current,...data};return mocks.current});
  mocks.owned.mockImplementation(async()=>mocks.current);
  mocks.startOAuth.mockResolvedValue('https://accounts.google.com/authorization');
});
describe('business connection setup cannot activate a company',()=>{
  it('creates only a pending API-key setup without OAuth or active credentials',async()=>{
    const result=await POST(request(setup));expect(result.status).toBe(201);
    expect(mocks.current).toMatchObject({status:'pending',authMethod:'apiKey',confirmedAt:null});
    expect(mocks.current).not.toHaveProperty('credentials');expect(mocks.startOAuth).not.toHaveBeenCalled();
  });
  it('rejects Google API-key authentication rather than pretending an ID grants access',async()=>{
    const result=await POST(request({...setup,platform:'google',externalId:'public-listing-id'}));
    expect(result.status).toBe(400);expect(mocks.upsert).not.toHaveBeenCalled();expect(mocks.startOAuth).not.toHaveBeenCalled();
  });
  it('does not pause or reclassify a confirmed OAuth connection while configuring a candidate key',async()=>{
    mocks.current={id:'connection-1',mode:'api',status:'connected',authMethod:'oauth',confirmedAt,credentials:'existing-encrypted-credential',inboxToken:'inbox'};
    expect((await POST(request(setup))).status).toBe(201);
    expect(mocks.current).toMatchObject({status:'connected',authMethod:'oauth',confirmedAt,credentials:'existing-encrypted-credential'});
  });
  it('keeps an active setup intact when OAuth initiation fails',async()=>{
    mocks.current={id:'connection-1',mode:'api',status:'connected',authMethod:'oauth',confirmedAt,inboxToken:'inbox'};
    mocks.startOAuth.mockRejectedValue(new Error('OAuth not configured'));
    expect((await POST(request({...setup,platform:'google',authMethod:'oauth'}))).status).toBe(503);
    expect(mocks.current).toMatchObject({status:'connected',confirmedAt});
  });
  it('requires explicit attestation for assisted and email associations',async()=>{
    const result=await POST(request({locationId:'location-1',platform:'tripadvisor',mode:'assisted'}));
    expect(result.status).toBe(400);expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it('rejects unowned internal locations before any setup or redirect',async()=>{
    mocks.findLocation.mockResolvedValue(null);
    expect((await POST(request(setup))).status).toBe(404);expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it('does not allow legacy PATCH mapping fields to bypass preview and acceptance',async()=>{
    mocks.current={id:'connection-1',platform:'google',mode:'api',status:'pending'};
    const result=await PATCH(request({accountId:'account',remoteLocationId:'listing'}),{params:Promise.resolve({id:'connection-1'})});
    expect(result.status).toBe(409);expect(mocks.update).not.toHaveBeenCalled();expect(mocks.current.status).toBe('pending');
  });
});
