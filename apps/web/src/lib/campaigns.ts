import { HttpError } from './security';
export function requireMessaging(channel:string) {
  if(!process.env.REDIS_URL)throw new HttpError(503,'Configurez Redis pour envoyer une campagne.');
  if(channel==='email' && (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)) throw new HttpError(503,'Configurez Resend et le domaine email avant les envois.');
  if(channel==='sms' && (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM)) throw new HttpError(503,'Configurez Twilio et le numéro expéditeur avant les envois SMS.');
}
// Compatibility export: entitlement policy is centralized, including downgrade limits.
export { requireEntitlement } from './entitlements';
