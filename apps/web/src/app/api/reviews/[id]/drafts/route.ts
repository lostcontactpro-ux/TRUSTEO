import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { apiError,guardMutation,rateLimit,HttpError } from '@/lib/security';
import { generateReplies,PROMPT_VERSION } from '@trusteo/core/ai/replies';
import { isEntitled } from '@trusteo/core/pricing';
import { aiTransport } from '@/lib/ai';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{guardMutation(request);const user=await requireUser();if(!isEntitled(user.subscription))throw new HttpError(402,'Abonnement actif requis');await rateLimit('ai:'+user.id,30,3600);const {id}=await params;const review=await db.review.findFirst({where:{id,location:{userId:user.id}},include:{location:true}});if(!review)throw new HttpError(404,'Avis introuvable');const drafts=await generateReplies({...review,locationName:review.location.name,city:review.location.city},aiTransport);await db.$transaction([db.replyDraft.deleteMany({where:{reviewId:id}}),db.replyDraft.createMany({data:drafts.map(d=>({...d,reviewId:id,promptVersion:PROMPT_VERSION}))})]);return Response.json({drafts});}catch(e){return apiError(e)}}
