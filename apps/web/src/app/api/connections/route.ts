import { requireEntitlement } from '@/lib/entitlements';
import { z } from 'zod';
import { providerDefinitions, platformIdSchema } from '@trusteo/core/providers/index';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { apiError, guardMutation, HttpError, jsonBody, rateLimit, token } from '@/lib/security';
import { publicConnection, startProviderOAuth, providerApiError } from '@/lib/providers';

const inputSchema=z.object({
  locationId:z.string().min(1),platform:platformIdSchema,mode:z.enum(['api','email','assisted']),
  authMethod:z.enum(['oauth','apiKey']).default('oauth'),
  externalId:z.string().trim().min(1).max(300).optional(),accepted:z.boolean().optional(),
}).strict();
export async function GET(){try{
  const user=await requireUser();
  const connections=await db.providerConnection.findMany({where:{location:{userId:user.id}},include:{location:{select:{id:true,name:true,city:true}}},orderBy:{createdAt:'desc'}});
  const platforms=providerDefinitions.map(({id,label,capabilities,modes,authMethods})=>({id,label,capabilities,modes,authMethods:authMethods??(capabilities.canRead?['oauth']:[])}));
  return Response.json({connections:connections.map(publicConnection),providers:platforms,inboundConfigured:!!process.env.INBOUND_EMAIL_DOMAIN});
}catch(error){return apiError(error)}}
export async function POST(request:Request){try{
  guardMutation(request);const user=await requireUser();await requireEntitlement(user);await rateLimit(`connections:${user.id}`,20);
  const input=inputSchema.parse(await jsonBody(request));
  const location=await db.location.findFirst({where:{id:input.locationId,userId:user.id}});
  if(!location)throw new HttpError(404,'Établissement introuvable.');
  const definition=providerDefinitions.find(item=>item.id===input.platform);
  if(!definition)throw new HttpError(400,'Plateforme inconnue.');
  if(!definition.modes.some(mode=>mode===input.mode))throw new HttpError(409,'Mode indisponible pour cette plateforme.');
  if(input.mode==='api'&&!(definition.authMethods??['oauth']).includes(input.authMethod))throw new HttpError(400,'Ce moyen de connexion n’est pas pris en charge par la plateforme. Google exige votre autorisation.');
  if(input.mode!=='api'&&input.accepted!==true)throw new HttpError(400,'Confirmez être autorisé à associer cet établissement avant de continuer.');
  if(input.mode==='email'&&!process.env.INBOUND_EMAIL_DOMAIN)throw new HttpError(503,'Le domaine de réception email doit être configuré.');
  const status=input.mode==='assisted'?'assisted':'pending';
  const data={mode:input.mode,authMethod:input.authMethod,status,externalId:input.externalId,confirmedAt:input.mode==='api'?null:new Date(),pendingPreview:null,previewTokenHash:null,previewExpiresAt:null,lastError:null};
  // Creating a setup is not activation. API connections remain pending until a
  // successful read-only preview and an explicit, one-use confirmation receipt.
  const connection=await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id} FOR UPDATE`;
    const existing=await tx.providerConnection.findUnique({where:{locationId_platform:{locationId:input.locationId,platform:input.platform}}});
    const preserveActive=existing?.mode==='api'&&existing.status==='connected'&&input.mode==='api';
    const update=preserveActive?{...data,status:existing.status,authMethod:existing.authMethod,confirmedAt:existing.confirmedAt}:data;
    return tx.providerConnection.upsert({where:{locationId_platform:{locationId:input.locationId,platform:input.platform}},create:{...data,locationId:input.locationId,platform:input.platform,inboxToken:token()},update});
  });
  if(!connection.inboxToken)await db.providerConnection.update({where:{id:connection.id},data:{inboxToken:token()}});
  const authorizationUrl=input.mode==='api'&&input.authMethod==='oauth'?await startProviderOAuth(connection,user.id):undefined;
  const refreshed=await db.providerConnection.findUniqueOrThrow({where:{id:connection.id}});
  return Response.json({connection:publicConnection(refreshed),authorizationUrl},{status:201});
}catch(error){try{providerApiError(error)}catch(mapped){return apiError(mapped)}}}
