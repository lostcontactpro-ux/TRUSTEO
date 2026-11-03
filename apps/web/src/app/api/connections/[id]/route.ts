import { requireEntitlement } from '@/lib/entitlements';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { apiError, guardMutation, HttpError, jsonBody, rateLimit } from '@/lib/security';
import { ownedConnection, publicConnection, startProviderOAuth, providerApiError } from '@/lib/providers';

const schema=z.object({mode:z.enum(['api','email','assisted']).optional(),reconnect:z.boolean().optional(),accepted:z.boolean().optional(),accountId:z.string().optional(),remoteLocationId:z.string().optional(),businessUnitId:z.string().optional()}).strict();
type Context={params:Promise<{id:string}>};
export async function PATCH(request:Request,{params}:Context){try{
  guardMutation(request);const user=await requireUser();await requireEntitlement(user);await rateLimit(`connections-edit:${user.id}`,20);
  const {id}=await params;const connection=await ownedConnection(id,user.id);const input=schema.parse(await jsonBody(request));
  // Older clients must not bypass the preview/acceptance stage through PATCH.
  if(input.accountId||input.remoteLocationId||input.businessUnitId)throw new HttpError(409,'Testez la connexion et vérifiez l’aperçu avant de confirmer votre entreprise.');
  if(input.reconnect){
    const authorizationUrl=await startProviderOAuth(connection,user.id);
    await db.providerConnection.update({where:{id},data:{status:'pending',authMethod:'oauth',pendingPreview:null,previewTokenHash:null,previewExpiresAt:null,confirmedAt:null}});
    return Response.json({authorizationUrl});
  }
  if(!input.mode)throw new HttpError(400,'Choisissez un mode de connexion.');
  if(input.mode==='api'&&!['google','trustpilot'].includes(connection.platform))throw new HttpError(409,'API indisponible ; utilisez le mode assisté ou email.');
  if(input.mode!=='api'&&input.accepted!==true)throw new HttpError(400,'Confirmez l’association à votre entreprise.');
  if(input.mode==='email'&&!process.env.INBOUND_EMAIL_DOMAIN)throw new HttpError(503,'Domaine de réception email manquant.');
  const updated=await db.providerConnection.update({where:{id},data:{mode:input.mode,status:input.mode==='assisted'?'assisted':'pending',confirmedAt:input.mode==='api'?null:new Date(),pendingPreview:null,previewTokenHash:null,previewExpiresAt:null,lastError:null}});
  return Response.json({connection:publicConnection(updated)});
}catch(error){try{providerApiError(error)}catch(mapped){return apiError(mapped)}}}
export async function DELETE(request:Request,{params}:Context){try{
  guardMutation(request);const user=await requireUser();const {id}=await params;await ownedConnection(id,user.id);
  await db.providerConnection.delete({where:{id}});return Response.json({deleted:true});
}catch(error){return apiError(error)}}
