import { Prisma } from '@prisma/client';
import { eligibleContact } from '@trusteo/core/campaigns';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { apiError,guardMutation,HttpError,rateLimit } from '@/lib/security';
import { requireEntitlement,requireMessaging } from '@/lib/campaigns';
import { enqueueCampaignRecipients } from '@/lib/queue';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{
  guardMutation(request);const user=await requireUser();requireEntitlement(user.subscription);await rateLimit(`campaign-send:${user.id}`,10,3600);const {id}=await params;
  const campaign=await db.campaign.findFirst({where:{id,userId:user.id},include:{location:true}});
  if(!campaign)throw new HttpError(404,'Campagne introuvable.');if(!campaign.location.reviewUrl)throw new HttpError(400,'Le lien de dépôt d’avis est requis.');requireMessaging(campaign.channel);
  await db.$transaction(async tx=>{
    // Lock the campaign to serialize repeat sends, creating each recipient once.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "Campaign" WHERE id=${id} FOR UPDATE`);
    const contacts=await tx.contact.findMany({where:{userId:user.id,unsubscribedAt:null}});
    const eligible=contacts.filter(c=>eligibleContact(c,campaign.channel as 'email'|'sms'));
    if(!eligible.length)throw new HttpError(400,'Aucun contact consentant et joignable.');
    const existing=await tx.campaignRecipient.count({where:{campaignId:id}});
    if(!existing){await tx.campaignRecipient.createMany({data:eligible.map(c=>({campaignId:id,contactId:c.id})),skipDuplicates:true});}
    await tx.campaign.update({where:{id},data:{status:'queued'}});
  });
  // A queue outage leaves durable pending recipients. Retry this endpoint after
  // Redis recovery: stable job IDs prevent duplicate fan-out.
  const pending=await db.campaignRecipient.findMany({where:{campaignId:id,status:{in:['pending','retry']}},select:{id:true}});
  await enqueueCampaignRecipients(pending.map(r=>r.id));
  return Response.json({queued:pending.length,status:'queued'});
}catch(e){return apiError(e);}}
