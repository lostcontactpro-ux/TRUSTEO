import { encryptCredentials } from '@trusteo/core/crypto';
import { requireEntitlement } from '@/lib/entitlements';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { appUrl } from '@/lib/env';
import { apiError, HttpError, rateLimit } from '@/lib/security';
import { consumeProviderOAuth, makeProvider, ownedConnection, providerApiError, readProviderCredentials } from '@/lib/providers';
export async function GET(request:Request){try{
  const user=await requireUser();await requireEntitlement(user);await rateLimit(`oauth-callback:${user.id}`,10);
  const url=new URL(request.url);const state=url.searchParams.get('state');
  if(!state||state.length!==64)throw new HttpError(403,'État OAuth invalide.');
  const data=await consumeProviderOAuth(state,user.id);
  if(url.searchParams.has('error'))throw new HttpError(400,'Connexion refusée par la plateforme.');
  const code=url.searchParams.get('code');if(!code||code.length>10000)throw new HttpError(400,'Code OAuth manquant.');
  const connection=await ownedConnection(data.connectionId,user.id);
  if(connection.platform!==data.platform)throw new HttpError(403,'Plateforme OAuth incompatible.');
  const credentials=readProviderCredentials(connection);
  delete credentials.apiKey;
  // A new OAuth grant can refer to another account. Pause imports before token
  // exchange and require a fresh preview even when reauthorizing a known listing.
  const pending=await db.providerConnection.update({where:{id:connection.id},data:{credentials:encryptCredentials(credentials),authMethod:'oauth',status:'pending',mode:'api',pendingPreview:null,previewTokenHash:null,previewExpiresAt:null,confirmedAt:null,lastError:null}});
  await makeProvider(pending).connect({code});
  return Response.redirect(`${appUrl()}/app/connections?configure=${encodeURIComponent(connection.id)}`,303);
}catch(error){try{providerApiError(error)}catch(mapped){return apiError(mapped)}}}
