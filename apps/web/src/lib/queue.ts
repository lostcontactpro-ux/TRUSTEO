import { Queue } from 'bullmq';
import { HttpError } from './security';
let delivery:Queue|undefined;
export function getDeliveryQueue():Queue {
  if(!process.env.REDIS_URL)throw new HttpError(503,'Redis est requis pour les envois.');
  const url=new URL(process.env.REDIS_URL);
  delivery??=new Queue('trusteo-delivery',{connection:{host:url.hostname,port:Number(url.port||6379),username:url.username||undefined,password:url.password?decodeURIComponent(url.password):undefined,db:Number(url.pathname.slice(1)||0),...(url.protocol==='rediss:'?{tls:{}}:{}),maxRetriesPerRequest:1}});
  return delivery;
}
export async function enqueueCampaignRecipients(ids:string[]) {
  if(!ids.length)return;
  const queue=getDeliveryQueue();
  for(const id of ids){
    const existing=await queue.getJob(`recipient-${id}`);
    if(existing){if(await existing.getState()==='failed')await existing.retry('failed');continue;}
    await queue.add('campaign-recipient',{recipientId:id},{jobId:`recipient-${id}`,attempts:5,backoff:{type:'exponential',delay:10000},removeOnComplete:{age:86400},removeOnFail:{age:604800}});
  }
}
