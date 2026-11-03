import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { apiError,guardMutation,rateLimit,HttpError,jsonBody } from '@/lib/security';
import { improveReply } from '@trusteo/core/ai/replies';
import { requireEntitlement } from '@/lib/entitlements';
import { aiTransport } from '@/lib/ai';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{guardMutation(request);const user=await requireUser();await requireEntitlement(user);await rateLimit('ai:'+user.id,30,3600);const {id}=await params;const{text}=z.object({text:z.string().min(5).max(2500)}).parse(await jsonBody(request));const review=await db.review.findFirst({where:{id,location:{userId:user.id}},include:{location:true}});if(!review)throw new HttpError(404,'Avis introuvable');return Response.json({text:await improveReply({...review,locationName:review.location.name,city:review.location.city},text,aiTransport)});}catch(e){return apiError(e)}}
