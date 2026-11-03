import { requireEntitlement } from '@/lib/entitlements';
import { z } from 'zod';
import { providerDefinitions, platformIds } from '@trusteo/core/providers/index';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { apiError, guardMutation, HttpError, jsonBody, rateLimit, token } from '@/lib/security';
import { publicConnection, startProviderOAuth, providerApiError } from '@/lib/providers';

const inputSchema=z.object({locationId:z.string().min(1),platform:z.enum(platformIds),mode:z.enum(['api','email','assisted']),externalId:z.string().trim().min(1).max(300).optional()}).strict();
export async function GET(){try{
  const user=await requireUser();
  const connections=await db.providerConnection.findMany({where:{location:{userId:user.id}},include:{location:{select:{id:true,name:true,city:true}}},orderBy:{createdAt:'desc'}});
  const platforms=providerDefinitions.map(({id,label,capabilities,modes})=>({id,label,capabilities,modes}));
  return Response.json({connections:connections.map(publicConnection),providers:platforms,inboundConfigured:!!process.env.INBOUND_EMAIL_DOMAIN});
}catch(error){return apiError(error)}}
export async function POST(request:Request){try{
  guardMutation(request);const user=await requireUser();await requireEntitlement(user);await rateLimit(`connections:${user.id}`,20);
  const input=inputSchema.parse(await jsonBody(request));
  const location=await db.location.findFirst({where:{id:input.locationId,userId:user.id}});
  if(!location)throw new HttpError(404,'Établissement introuvable.');
  const definition=providerDefinitions.find(item=>item.id===input.platform)!;
  if(!definition.modes.some(mode=>mode===input.mode))throw new HttpError(409,'Mode indisponible pour cette plateforme.');
  if(input.mode==='email'&&!process.env.INBOUND_EMAIL_DOMAIN)throw new HttpError(503,'Le domaine de réception email doit être configuré.');
  const status=input.mode==='assisted'?'assisted':'pending';
  const connection=await db.providerConnection.upsert({where:{locationId_platform:{locationId:input.locationId,platform:input.platform}},create:{...input,status,inboxToken:token()},update:{mode:input.mode,status,...(input.externalId?{externalId:input.externalId}:{}),lastError:null}});
  if(!connection.inboxToken)await db.providerConnection.update({where:{id:connection.id},data:{inboxToken:token()}});
  const authorizationUrl=input.mode==='api'?await startProviderOAuth(connection,user.id):undefined;
  const refreshed=await db.providerConnection.findUniqueOrThrow({where:{id:connection.id}});
  return Response.json({connection:publicConnection(refreshed),authorizationUrl},{status:201});
}catch(error){try{providerApiError(error)}catch(mapped){return apiError(mapped)}}}
