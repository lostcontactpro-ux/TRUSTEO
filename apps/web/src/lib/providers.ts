import { cookies } from 'next/headers';
import type { ProviderConnection } from '@prisma/client';
import { Queue } from 'bullmq';
import { z } from 'zod';
import { createProvider, ProviderError, providerRegistry, type ProviderCredentials, type PlatformId } from '@trusteo/core/providers/index';
import { decryptCredentials, encryptCredentials } from '@trusteo/core/crypto';
import { isEntitled } from '@trusteo/core/pricing';
import { db } from './db';
import { appUrl } from './env';
import { constantTimeEqual, hashToken, HttpError, token } from './security';

const storedCredentials = z.object({
  accessToken:z.string().optional(), refreshToken:z.string().optional(), expiresAt:z.number().optional(),
  apiKey:z.string().optional(), accountId:z.string().optional(), remoteLocationId:z.string().optional(), businessUnitId:z.string().optional(),
});
export function readProviderCredentials(connection: Pick<ProviderConnection, 'credentials'>): ProviderCredentials {
  return connection.credentials ? storedCredentials.parse(decryptCredentials(connection.credentials)) : {};
}
export function providerOAuth(platform: string) {
  const prefix = platform === 'google' ? 'GOOGLE' : platform === 'trustpilot' ? 'TRUSTPILOT' : null;
  if (!prefix) return undefined;
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  return clientId && clientSecret ? { clientId, clientSecret, redirectUri: `${appUrl()}/api/connections/oauth/callback` } : undefined;
}
export function makeProvider(connection: ProviderConnection) {
  return createProvider(connection.platform, {
    locationId: connection.locationId, credentials: readProviderCredentials(connection), oauth: providerOAuth(connection.platform),
    refreshCredentials: async refresh=>db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "ProviderConnection" WHERE id=${connection.id} FOR UPDATE`;
      const current=await tx.providerConnection.findUniqueOrThrow({where:{id:connection.id}});
      const verified=readProviderCredentials(current);
      const tokens=await refresh(verified);
      const saved={...verified,accessToken:tokens.accessToken,refreshToken:tokens.refreshToken,expiresAt:tokens.expiresAt};
      await tx.providerConnection.update({where:{id:connection.id},data:{credentials:encryptCredentials(saved)}});
      return saved;
    },{maxWait:10000,timeout:45000}),
    onTokens: async credentials => {
      // A verification request may hold candidate resource IDs. Persist only tokens
      // until the caller has verified and committed its resource selection.
      await db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM "ProviderConnection" WHERE id=${connection.id} FOR UPDATE`;
        const current=await tx.providerConnection.findUniqueOrThrow({where:{id:connection.id}});
        const verified=readProviderCredentials(current);
        await tx.providerConnection.update({where:{id:connection.id},data:{credentials:encryptCredentials({
          ...verified,accessToken:credentials.accessToken,refreshToken:credentials.refreshToken,expiresAt:credentials.expiresAt,
        })}});
      });
    },
  });
}
export function checkProviderSubscription(subscription: Parameters<typeof isEntitled>[0]) {
  if (!isEntitled(subscription)) throw new HttpError(402, 'Un essai ou abonnement actif est requis.');
}
export function providerApiError(error: unknown): never {
  if (error instanceof ProviderError) {
    const status = error.code === 'configuration' || error.code === 'unsupported' ? 409 : error.code === 'authorization' ? 403 : error.code === 'rate_limit' ? 429 : error.code === 'validation' ? 400 : 502;
    throw new HttpError(status, error.message);
  }
  throw error;
}
export function publicConnection(connection: ProviderConnection & {location?:{id:string;name:string;city?:string}}) {
  const domain = process.env.INBOUND_EMAIL_DOMAIN;
  return {
    id:connection.id,locationId:connection.locationId,platform:connection.platform,mode:connection.mode,status:connection.status,
    externalId:connection.externalId,lastSyncedAt:connection.lastSyncedAt,lastError:connection.lastError,
    createdAt:connection.createdAt,updatedAt:connection.updatedAt,
    authMethod:connection.authMethod,testedAt:connection.testedAt,confirmedAt:connection.confirmedAt,hasPendingPreview:!!connection.pendingPreview,
    capabilities:{...providerRegistry.get(connection.platform)?.capabilities,canReply:connection.mode==='api'&&connection.status==='connected'&&!!connection.confirmedAt&&connection.authMethod!=='apiKey'&&!!providerRegistry.get(connection.platform)?.capabilities.canReply},
    ...(connection.location?{location:{id:connection.location.id,name:connection.location.name,city:connection.location.city}}:{}),
    inboxAddress:connection.inboxToken&&domain?`${connection.inboxToken}@${domain}`:null,
    hasCredentials:!!connection.credentials,
  };
}
export async function ownedConnection(id:string,userId:string) {
  const connection=await db.providerConnection.findFirst({where:{id,location:{userId}},include:{location:{select:{id:true,name:true,city:true}}}});
  if(!connection)throw new HttpError(404,'Connexion introuvable.');
  return connection;
}

const OAUTH_COOKIE='trusteo_provider_oauth';
const oauthState=z.object({state:z.string().length(64),userId:z.string(),connectionId:z.string(),platform:z.enum(['google','trustpilot']),expiresAt:z.number()});
/** State is bound to the authenticated user and encrypted HttpOnly browser cookie.
 * A hashed DB marker makes consumption one-use across web instances. */
export async function startProviderOAuth(connection:ProviderConnection,userId:string) {
  if(!['google','trustpilot'].includes(connection.platform))throw new HttpError(409,'Cette plateforme utilise le mode email ou assisté.');
  if(!providerOAuth(connection.platform))throw new HttpError(503,'Les identifiants OAuth de cette plateforme ne sont pas configurés.');
  const state=token();
  const result=await makeProvider({...connection,credentials:null}).connect({state});
  if(!result.authorizationUrl)throw new HttpError(502,'La plateforme ne fournit pas de redirection OAuth.');
  const jar=await cookies();
  const old=jar.get(OAUTH_COOKIE)?.value;
  if(old){try{const previous=oauthState.parse(decryptCredentials(old));await db.webhookEvent.deleteMany({where:{id:`oauth-state:${hashToken(previous.state)}`,provider:'oauth-state'}});}catch{/* An expired cookie is safely replaced. */}}
  const data={state,userId,connectionId:connection.id,platform:connection.platform,expiresAt:Date.now()+600000};
  const encrypted=encryptCredentials(data);
  await db.webhookEvent.create({data:{id:`oauth-state:${hashToken(state)}`,provider:'oauth-state',type:connection.id}});
  jar.set(OAUTH_COOKIE,encrypted,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/api/connections/oauth',maxAge:600});
  return result.authorizationUrl;
}
export async function consumeProviderOAuth(state:string,userId:string) {
  const jar=await cookies();const value=jar.get(OAUTH_COOKIE)?.value;
  jar.set(OAUTH_COOKIE,'',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/api/connections/oauth',maxAge:0});
  if(!value)throw new HttpError(403,'Session OAuth expirée. Recommencez la connexion.');
  let data:z.infer<typeof oauthState>;
  try{data=oauthState.parse(decryptCredentials(value));}catch{throw new HttpError(403,'Session OAuth invalide.');}
  if(data.userId!==userId||data.expiresAt<Date.now()||!constantTimeEqual(data.state,state))throw new HttpError(403,'État OAuth invalide ou expiré.');
  const consumed=await db.webhookEvent.deleteMany({where:{id:`oauth-state:${hashToken(state)}`,provider:'oauth-state',type:data.connectionId,processedAt:{gte:new Date(Date.now()-600000)}}});
  if(consumed.count!==1)throw new HttpError(403,'Cette session OAuth a déjà été utilisée.');
  return data;
}

let syncQueue:Queue|undefined;
export async function queueProviderSync(connectionId:string) {
  if(!process.env.REDIS_URL)throw new HttpError(503,'Redis est requis pour la synchronisation.');
  const url=new URL(process.env.REDIS_URL);
  syncQueue??=new Queue('trusteo-sync',{connection:{host:url.hostname,port:Number(url.port||6379),username:url.username||undefined,password:url.password?decodeURIComponent(url.password):undefined,db:Number(url.pathname.slice(1)||0),...(url.protocol==='rediss:'?{tls:{}}:{}),maxRetriesPerRequest:1}});
  const job=await syncQueue.add('sync-connection',{connectionId},{jobId:`manual-${connectionId}-${Math.floor(Date.now()/15000)}`,attempts:5,backoff:{type:'exponential',delay:15000},removeOnComplete:{age:86400},removeOnFail:{age:604800}});
  return job.id;
}
export function requireApiProvider(platform:string) {
  const definition=providerRegistry.get(platform as PlatformId);
  if(!definition?.capabilities.canRead)throw new HttpError(409,'Cette plateforme utilise le mode email ou assisté.');
  return definition;
}

let notificationQueue:Queue|undefined;
export async function enqueueInboundReviewNotification(reviewId:string) {
  if(!process.env.REDIS_URL)throw new HttpError(503,'Redis est requis pour les notifications.');
  const url=new URL(process.env.REDIS_URL);
  notificationQueue??=new Queue('trusteo-notifications',{connection:{host:url.hostname,port:Number(url.port||6379),username:url.username||undefined,password:url.password?decodeURIComponent(url.password):undefined,db:Number(url.pathname.slice(1)||0),...(url.protocol==='rediss:'?{tls:{}}:{}),maxRetriesPerRequest:1}});
  await notificationQueue.add('new-review',{reviewId},{jobId:`notice-${reviewId}`,attempts:5,backoff:{type:'exponential',delay:15000},removeOnComplete:{age:86400},removeOnFail:{age:604800}});
}
