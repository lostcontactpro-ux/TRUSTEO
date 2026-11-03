import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { apiError,guardMutation,HttpError } from '@/lib/security';
import { locationInput } from '@/lib/locations';
type Context={params:Promise<{id:string}>};
export async function PATCH(request:Request,{params}:Context){try{guardMutation(request);const user=await requireUser();const {id}=await params;const data=locationInput.partial().parse(await request.json());const result=await db.location.updateMany({where:{id,userId:user.id},data:{...data,reviewUrl:data.reviewUrl===''?null:data.reviewUrl}});if(!result.count)throw new HttpError(404,'Établissement introuvable');return Response.json({ok:true})}catch(e){return apiError(e)}}
export async function DELETE(request:Request,{params}:Context){try{guardMutation(request);const user=await requireUser();const{id}=await params;const result=await db.location.deleteMany({where:{id,userId:user.id}});if(!result.count)throw new HttpError(404,'Établissement introuvable');return Response.json({ok:true})}catch(e){return apiError(e)}}
