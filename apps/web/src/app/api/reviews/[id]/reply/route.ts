import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { apiError,guardMutation,rateLimit,HttpError,jsonBody } from '@/lib/security';
import { requireEntitlement } from '@/lib/entitlements';
import { isProviderUrl } from '@trusteo/core/providers/index';
import { makeProvider } from '@/lib/providers';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{
  guardMutation(request);const user=await requireUser();await requireEntitlement(user);await rateLimit('reply:'+user.id,60,3600);
  const{id}=await params;const{text}=z.object({text:z.string().trim().min(2).max(2500)}).parse(await jsonBody(request));
  const review=await db.review.findFirst({where:{id,location:{userId:user.id}},include:{connection:true}});
  if(!review)throw new HttpError(404,'Avis introuvable');
  if(review.connection.mode==='api'&&(review.connection.status!=='connected'||!review.connection.confirmedAt))throw new HttpError(409,'Vérifiez l’aperçu et confirmez votre entreprise avant de publier.');
  const provider=review.connection.mode==='api'?makeProvider(review.connection):null;
  if(!provider?.capabilities.canReply){
    if(!review.sourceUrl||!isProviderUrl(review.platform,review.sourceUrl))throw new HttpError(400,'Lien source invalide');
    return Response.json({assisted:true,url:review.sourceUrl,text,status:'requires_manual_publication'});
  }
  await provider.reply(review.externalId,text);
  await db.review.update({where:{id},data:{replyText:text,repliedAt:new Date(),status:'replied'}});
  return Response.json({ok:true,status:'published'});
}catch(e){return apiError(e)}}
