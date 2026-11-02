import { z } from 'zod';

export const contactInput = z.object({
  email: z.email().max(254).transform(v => v.toLowerCase().trim()),
  name: z.string().trim().min(1).max(120).optional(),
  firstName: z.string().trim().min(1).max(120).optional(),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional().or(z.literal('')),
  consent: z.literal(true),
  consentSource: z.string().trim().min(3).max(500),
}).refine(v => Boolean(v.name || v.firstName), {message:'Le nom est requis.'});

export const campaignInput = z.object({
  name: z.string().trim().min(2).max(100),
  locationId: z.string().min(1).max(100),
  channel: z.enum(['email','sms']).default('email'),
  // A fixed neutral template prevents hidden conditions in free-form copy.
  // Every eligible contact receives the same invitation.
  message: z.enum(['Merci de votre visite !','Merci de votre confiance !','Thank you for visiting!','Thank you for your trust!']).default('Merci de votre visite !'),
  offer: z.string().trim().max(200).optional(),
}).superRefine((value, ctx) => {
  if (value.offer) ctx.addIssue({code:'custom',path:['offer'],message:'Les promotions sont séparées des avis. Utilisez la fidélité, sans contrepartie liée à un avis.'});
  if (/\b(positif|positive|5\s*[\/*]|cinq étoiles|bonne note|satisfait|satisfied|positive review|discount|réduction|remise|offert|cadeau|reward|coupon)\b/i.test(value.message)) {
    ctx.addIssue({code:'custom',path:['message'],message:'Utilisez un message neutre, sans sélection ni récompense liée à un avis.'});
  }
});

export function eligibleContact(contact: {consentAt:Date|null; consentSource:string; unsubscribedAt:Date|null; phone?:string|null}, channel:'email'|'sms'): boolean {
  return Boolean(contact.consentAt && contact.consentSource.trim() && !contact.unsubscribedAt && (channel !== 'sms' || contact.phone));
}

export function renderInvitation(input: {businessName:string; reviewUrl:string; unsubscribeUrl:string; message?:string}) {
  const text = `${input.message?.trim() || 'Merci de votre visite !'}\n\nPartagez votre expérience réelle chez ${input.businessName}, quelle que soit votre appréciation : ${input.reviewUrl}\n\nVotre avis est libre, sans récompense ni condition de note.\nDésinscription : ${input.unsubscribeUrl}`;
  return {subject:`Votre expérience chez ${input.businessName}`,text};
}

/** RFC4180-style CSV reader: quotes, escaped quotes, CRLF, multiline fields. */
export function parseContactsCsv(source:string) {
  if (source.length > 1_000_000) throw new Error('CSV trop volumineux.');
  const rows:string[][] = []; let row:string[]=[]; let value=''; let quoted=false;
  const data=source.replace(/^\uFEFF/,'');
  for(let i=0;i<data.length;i++){
    const ch=data[i];
    if(ch==='"'){
      if(quoted && data[i+1]==='"'){value+='"';i++;}
      else if(quoted){quoted=false;if(data[i+1] && ![',','\r','\n'].includes(data[i+1])) throw new Error('CSV invalide après guillemet.');}
      else if(value===''){quoted=true;}
      else throw new Error('Guillemet CSV mal placé.');
    } else if(ch===','&&!quoted){row.push(value);value='';}
    else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&data[i+1]==='\n')i++;row.push(value);if(row.some(v=>v.trim()))rows.push(row);row=[];value='';}
    else value+=ch;
  }
  if(quoted)throw new Error('Champ CSV non terminé.');
  row.push(value);if(row.some(v=>v.trim()))rows.push(row);
  const headers=rows.shift()?.map(v=>v.trim().toLowerCase());
  if(!headers?.includes('email') || !headers.includes('consent') || !headers.includes('consentsource')) throw new Error('Colonnes requises : email,name,consent,consentSource (consent=true).');
  if(rows.length>5000)throw new Error('Maximum 5 000 contacts par import.');
  return rows.map((values,index)=>{
    if(values.length!==headers.length)throw new Error(`Nombre de colonnes invalide à la ligne ${index+2}.`);
    const record=Object.fromEntries(headers.map((h,i)=>[h,values[i].trim()]));
    return contactInput.parse({email:record.email,name:record.name,firstName:record.firstname,phone:record.phone,consent:record.consent==='true',consentSource:record.consentsource});
  });
}
