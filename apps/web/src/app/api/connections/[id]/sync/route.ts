import { requireEntitlement } from '@/lib/entitlements';
import { requireUser } from '@/lib/auth';
import { apiError, guardMutation, HttpError, rateLimit } from '@/lib/security';
import { ownedConnection, queueProviderSync } from '@/lib/providers';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{
  guardMutation(request);const user=await requireUser();await requireEntitlement(user);await rateLimit(`sync:${user.id}`,5);
  const {id}=await params;const connection=await ownedConnection(id,user.id);
  if(connection.mode!=='api'||connection.status!=='connected')throw new HttpError(409,'Une connexion API opérationnelle est requise.');
  const jobId=await queueProviderSync(connection.id);return Response.json({queued:true,jobId},{status:202});
}catch(error){return apiError(error)}}
