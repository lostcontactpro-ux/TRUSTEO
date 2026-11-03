import { requireEntitlement } from '@/lib/entitlements';
import { z } from 'zod';
import { isProviderUrl, parseNotificationEmail, platformIds } from '@trusteo/core/providers/index';
import { db } from '@/lib/db';
import { apiError, HttpError, rateLimit } from '@/lib/security';
import { enqueueInboundReviewNotification, providerApiError } from '@/lib/providers';
import { validGatewaySignature } from './signature';

const schema=z.object({
  recipient:z.email().max(500),messageId:z.string().min(1).max(1000),subject:z.string().max(2000),text:z.string().min(1).max(100000),receivedAt:z.coerce.date(),
  // The trusted gateway must verify original DKIM/ARC, not just the forwarder's From header.
  authentication:z.object({verified:z.literal(true),originalSenderDomain:z.string().toLowerCase().regex(/^[a-z0-9.-]{1,253}$/)}).strict(),
}).strict();
export async function POST(request:Request){try{
  const secret=process.env.INBOUND_WEBHOOK_SECRET;
  if(!secret||secret.length<32||!process.env.INBOUND_EMAIL_DOMAIN)throw new HttpError(503,'La passerelle email entrante n’est pas configurée.');
  if(Number(request.headers.get('content-length')??0)>1000000)throw new HttpError(413,'Message trop volumineux.');
  const body=await request.text();if(Buffer.byteLength(body)>1000000)throw new HttpError(413,'Message trop volumineux.');
  const id=request.headers.get('x-trusteo-id')??'';
  if(!validGatewaySignature({id,timestamp:request.headers.get('x-trusteo-timestamp')??'',signature:request.headers.get('x-trusteo-signature')??'',body,secret}))throw new HttpError(401,'Signature de la passerelle invalide ou expirée.');
  await rateLimit('inbound-email-global',120,60);
  let parsed:unknown;try{parsed=JSON.parse(body)}catch{throw new HttpError(400,'JSON invalide.');}
  const input=schema.parse(parsed);const [alias,domain]=input.recipient.toLowerCase().split('@');
  if(domain!==process.env.INBOUND_EMAIL_DOMAIN.toLowerCase()||!/^[a-f0-9]{64}$/.test(alias))throw new HttpError(404,'Adresse entrante inconnue.');
  const connection=await db.providerConnection.findUnique({where:{inboxToken:alias},include:{location:{include:{user:{include:{subscription:true}}}}}});
  if(!connection||connection.mode!=='email')throw new HttpError(404,'Connexion email inconnue.');
  await requireEntitlement(connection.location.user);await rateLimit(`inbound-email:${connection.id}`,60);
  const platform=z.enum(platformIds).parse(connection.platform);
  if(!isProviderUrl(platform,`https://${input.authentication.originalSenderDomain}/`))throw new HttpError(403,'Expéditeur original incompatible avec la plateforme.');
  const review=parseNotificationEmail(platform,connection.locationId,input);
  if(review.publishedAt.getTime()>Date.now()+86400000)throw new HttpError(400,'La date de l’avis est invalide.');
  const eventId=`inbound-email:${id}`;
  const eventType=await db.$transaction(async tx=>{
    const inserted=await tx.webhookEvent.createMany({data:[{id:eventId,provider:'inbound-email',type:'pending'}],skipDuplicates:true});
    if(inserted.count===0){const event=await tx.webhookEvent.findUniqueOrThrow({where:{id:eventId}});return event.type;}
    const data={connectionId:connection.id,locationId:connection.locationId,externalId:review.externalId,platform:review.platform,author:review.author,rating:review.rating,text:review.text,language:review.language,publishedAt:review.publishedAt,sourceUrl:review.sourceUrl,status:'pending'};
    const created=await tx.review.createMany({data:[data],skipDuplicates:true});
    const saved=await tx.review.update({where:{connectionId_externalId:{connectionId:connection.id,externalId:review.externalId}},data:{author:review.author,rating:review.rating,text:review.text,language:review.language,publishedAt:review.publishedAt,sourceUrl:review.sourceUrl}});
    if(created.count===1)await tx.notification.create({data:{id:`review-${saved.id}`,userId:connection.location.userId,reviewId:saved.id,title:review.rating<3.3?'Avis prioritaire à traiter':'Nouvel avis reçu',body:`${connection.location.name} : ${review.rating}/5 — ${review.author}`,url:'/app/reviews'}});
    const type=created.count===1?`review-notification:${saved.id}`:'duplicate-review';
    await tx.webhookEvent.update({where:{id:eventId},data:{type}});
    await tx.providerConnection.update({where:{id:connection.id},data:{status:'connected',lastSyncedAt:new Date(),lastError:null}});
    return type;
  });
  // On queue failure, return 503; a signed gateway retry resumes this durable outbox event.
  if(eventType.startsWith('review-notification:'))await enqueueInboundReviewNotification(eventType.slice('review-notification:'.length));
  return Response.json({accepted:true,duplicate:eventType==='duplicate-review'},{status:202});
}catch(error){try{providerApiError(error)}catch(mapped){return apiError(mapped)}}}
