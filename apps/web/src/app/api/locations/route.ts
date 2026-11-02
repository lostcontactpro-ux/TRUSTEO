import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { apiError, guardMutation, HttpError } from '@/lib/security';
import { assertLocationCapacity } from '@trusteo/core/pricing';
export const locationInput = z.object({name:z.string().trim().min(2).max(100),address:z.string().trim().min(3).max(200),city:z.string().trim().min(2).max(100),reviewUrl:z.union([z.url().startsWith('https://'),z.literal('')]).optional()});
export async function GET(){try{const user=await requireUser();return Response.json({locations:await db.location.findMany({where:{userId:user.id},orderBy:{createdAt:'asc'}})});}catch(e){return apiError(e)}}
export async function POST(request:Request){try{guardMutation(request);const user=await requireUser();const input=locationInput.parse(await request.json());const location=await db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id} FOR UPDATE`;const subscription=await tx.subscription.findUnique({where:{userId:user.id}});if(!subscription)throw new HttpError(402,'Abonnement requis');const count=await tx.location.count({where:{userId:user.id}});assertLocationCapacity(subscription,count);return tx.location.create({data:{...input,reviewUrl:input.reviewUrl||null,userId:user.id}});},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});return Response.json({location},{status:201})}catch(e){return apiError(e)}}
