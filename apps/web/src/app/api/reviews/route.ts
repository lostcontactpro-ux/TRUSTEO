import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { apiError } from '@/lib/security';
export async function GET(request:Request){try{const user=await requireUser();const locationId=new URL(request.url).searchParams.get('locationId')||undefined;const reviews=await db.review.findMany({where:{location:{userId:user.id},locationId},include:{location:{select:{id:true,name:true,city:true}},connection:{select:{mode:true,platform:true}},drafts:{orderBy:{createdAt:'desc'},take:3}},orderBy:{publishedAt:'desc'},take:100});return Response.json({reviews});}catch(e){return apiError(e)}}
