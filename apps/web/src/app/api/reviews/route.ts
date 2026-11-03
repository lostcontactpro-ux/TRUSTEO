import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { apiError } from '@/lib/security';
import { providerRegistry } from '@trusteo/core/providers/index';
export async function GET(request:Request){try{
  const user=await requireUser();const locationId=new URL(request.url).searchParams.get('locationId')||undefined;
  const rows=await db.review.findMany({where:{location:{userId:user.id},locationId},include:{location:{select:{id:true,name:true,city:true}},connection:{select:{mode:true,platform:true,authMethod:true,status:true,confirmedAt:true}},drafts:{orderBy:{createdAt:'desc'},take:3}},orderBy:{publishedAt:'desc'},take:100});
  const reviews=rows.map(review=>({...review,connection:{...review.connection,capabilities:{...providerRegistry.get(review.platform)?.capabilities,canReply:review.connection.mode==='api'&&review.connection.status==='connected'&&!!review.connection.confirmedAt&&review.connection.authMethod!=='apiKey'&&!!providerRegistry.get(review.platform)?.capabilities.canReply}}}));
  return Response.json({reviews});
}catch(e){return apiError(e)}}
