import { z } from 'zod';
import { contactInput, parseContactsCsv } from '@trusteo/core/campaigns';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { apiError, guardMutation, jsonBody, HttpError, rateLimit, token } from '@/lib/security';
export async function GET(){try{const user=await requireUser();return Response.json({contacts:await db.contact.findMany({where:{userId:user.id},orderBy:{createdAt:'desc'},take:5000})});}catch(e){return apiError(e);}}
export async function POST(request:Request){try{
  guardMutation(request);const user=await requireUser();await rateLimit(`contacts:${user.id}`,10,60);
  const body=await jsonBody(request);let contacts;
  if(typeof body==='object' && body!==null && 'csv' in body){const {csv}=z.object({csv:z.string().max(1_000_000)}).parse(body);try{contacts=parseContactsCsv(csv);}catch{throw new HttpError(400,'CSV invalide : email,name,consent,consentSource requis. Consentement explicite true obligatoire.');}}
  else contacts=z.object({contacts:z.array(contactInput).min(1).max(5000)}).parse(body).contacts;
  const unique=[...new Map(contacts.map(c=>[c.email,c])).values()];
  // Never revive an unsubscribed contact by reimporting a spreadsheet. A fresh
  // consent flow must be independently recorded outside bulk import.
  const result=await db.contact.createMany({data:unique.map(c=>({userId:user.id,email:c.email,name:c.name||c.firstName!,phone:c.phone||null,consentAt:new Date(),consentSource:c.consentSource,unsubscribeToken:token()})),skipDuplicates:true});
  return Response.json({imported:result.count,duplicates:unique.length-result.count}, {status:201});
}catch(e){return apiError(e);}}
