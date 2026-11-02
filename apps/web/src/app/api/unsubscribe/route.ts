import { z } from 'zod';
import { db } from '@/lib/db';
import { apiError,jsonBody,rateLimit } from '@/lib/security';
// GET deliberately never changes preferences: security scanners follow email links.
export async function GET(request:Request){try{const value=new URL(request.url).searchParams.get('token');const token=z.string().regex(/^[a-f0-9]{64}$/).parse(value);const contact=await db.contact.findUnique({where:{unsubscribeToken:token},select:{unsubscribedAt:true}});return Response.json({valid:Boolean(contact),unsubscribed:Boolean(contact?.unsubscribedAt),confirmationRequired:true});}catch(e){return apiError(e);}}
export async function POST(request:Request){try{await rateLimit('unsubscribe-global',1000,60);const input=z.object({token:z.string().regex(/^[a-f0-9]{64}$/)}).parse(await jsonBody(request));await db.contact.updateMany({where:{unsubscribeToken:input.token,unsubscribedAt:null},data:{unsubscribedAt:new Date()}});return Response.json({unsubscribed:true});}catch(e){return apiError(e);}}
