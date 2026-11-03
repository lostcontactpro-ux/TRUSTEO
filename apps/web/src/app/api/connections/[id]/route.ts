import { requireEntitlement } from '@/lib/entitlements';
import { z } from 'zod';
import { encryptCredentials } from '@trusteo/core/crypto';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { apiError, guardMutation, HttpError, jsonBody, rateLimit } from '@/lib/security';
import { ownedConnection, publicConnection, readProviderCredentials, startProviderOAuth, makeProvider, providerApiError } from '@/lib/providers';

const schema=z.object({mode:z.enum(['api','email','assisted']).optional(),accountId:z.string().regex(/^[A-Za-z0-9_-]+$/).max(200).optional(),remoteLocationId:z.string().regex(/^[A-Za-z0-9_-]+$/).max(200).optional(),businessUnitId:z.string().regex(/^[A-Za-z0-9_-]+$/).max(200).optional(),reconnect:z.boolean().optional()}).strict();
type Context={params:Promise<{id:string}>};
export async function PATCH(request:Request,{params}:Context){try{
  guardMutation(request);const user=await requireUser();await requireEntitlement(user);await rateLimit(`connections-edit:${user.id}`,20);
  const {id}=await params;const connection=await ownedConnection(id,user.id);const input=schema.parse(await jsonBody(request));
  if(input.reconnect){const authorizationUrl=await startProviderOAuth(connection,user.id);return Response.json({authorizationUrl});}
  const mode=input.mode??connection.mode;
  if(mode==='api'&&!['google','trustpilot'].includes(connection.platform))throw new HttpError(409,'API indisponible ; utilisez le mode assisté ou email.');
  if(mode==='email'&&!process.env.INBOUND_EMAIL_DOMAIN)throw new HttpError(503,'Domaine de réception email manquant.');
  const previousCredentials=readProviderCredentials(connection);
  const credentials={...previousCredentials,...(input.accountId?{accountId:input.accountId}:{}),...(input.remoteLocationId?{remoteLocationId:input.remoteLocationId}:{}),...(input.businessUnitId?{businessUnitId:input.businessUnitId}:{})};
  const resourceChanged=['accountId','remoteLocationId','businessUnitId'].some(key=>credentials[key as keyof typeof credentials]!==previousCredentials[key as keyof typeof previousCredentials]);
  if(resourceChanged&&await db.review.count({where:{connectionId:id}})>0)throw new HttpError(409,'Cette connexion contient déjà des avis. Déconnectez-la avant de sélectionner une autre fiche.');
  if(input.accountId&&connection.platform!=='google'||input.remoteLocationId&&connection.platform!=='google'||input.businessUnitId&&connection.platform!=='trustpilot')throw new HttpError(400,'Identifiant incompatible avec la plateforme.');
  let status=mode==='assisted'?'assisted':'pending';
  if(mode==='api'){
    if(!credentials.accessToken&&!credentials.refreshToken)throw new HttpError(409,'Effectuez d’abord la connexion OAuth.');
    if(connection.platform==='google'&&(!credentials.accountId||!credentials.remoteLocationId))throw new HttpError(400,'Sélectionnez le compte et l’établissement Google.');
    if(connection.platform==='trustpilot'&&!credentials.businessUnitId)throw new HttpError(400,'Le Business Unit ID Trustpilot est requis.');
    // Verify permissions on the selected resource before reporting it connected.
    const verifying=makeProvider({...connection,credentials:encryptCredentials(credentials)});
    await verifying.fetchReviews(new Date(Date.now()-86400000));status='connected';
    // The verification may rotate OAuth tokens through onTokens. Merge only resource IDs below.
    const refreshed=await db.providerConnection.findUniqueOrThrow({where:{id}});
    Object.assign(credentials,readProviderCredentials(refreshed),...(input.accountId?[{accountId:input.accountId}]:[]),...(input.remoteLocationId?[{remoteLocationId:input.remoteLocationId}]:[]),...(input.businessUnitId?[{businessUnitId:input.businessUnitId}]:[]));
  }
  const updated=await db.$transaction(async tx=>{
    // Synchronizers also write reviews: recheck immediately before changing the mapping.
    await tx.$queryRaw`SELECT id FROM "ProviderConnection" WHERE id=${id} FOR UPDATE`;
    const current=await tx.providerConnection.findUniqueOrThrow({where:{id}});
    const persisted=readProviderCredentials(current);
    const changed=['accountId','remoteLocationId','businessUnitId'].some(key=>credentials[key as keyof typeof credentials]!==persisted[key as keyof typeof persisted]);
    if(changed&&await tx.review.count({where:{connectionId:id}})>0)throw new HttpError(409,'Cette connexion contient déjà des avis. Déconnectez-la avant de sélectionner une autre fiche.');
    const savedCredentials={...credentials,accessToken:persisted.accessToken??credentials.accessToken,refreshToken:persisted.refreshToken??credentials.refreshToken,expiresAt:persisted.expiresAt??credentials.expiresAt};
    return tx.providerConnection.update({where:{id},data:{mode,status,lastError:null,...(Object.keys(savedCredentials).length?{credentials:encryptCredentials(savedCredentials)}:{})}});
  });
  return Response.json({connection:publicConnection(updated)});
}catch(error){try{providerApiError(error)}catch(mapped){return apiError(mapped)}}}
export async function DELETE(request:Request,{params}:Context){try{
  guardMutation(request);const user=await requireUser();const {id}=await params;await ownedConnection(id,user.id);
  await db.providerConnection.delete({where:{id}});return Response.json({deleted:true});
}catch(error){return apiError(error)}}
