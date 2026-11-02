import { createHmac, timingSafeEqual } from 'node:crypto';

/** Generic gateway v1 protocol; this is deliberately not a native Resend/Svix signature. */
export function validGatewaySignature(input:{id:string;timestamp:string;signature:string;body:string;secret:string;now?:number}):boolean {
  if(input.secret.length<32||!/^[A-Za-z0-9_-]{1,128}$/.test(input.id)||!/^\d{10}$/.test(input.timestamp)||!/^v1=[a-f0-9]{64}$/.test(input.signature))return false;
  if(Math.abs((input.now??Date.now())/1000-Number(input.timestamp))>300)return false;
  const expected=createHmac('sha256',input.secret).update(`${input.id}.${input.timestamp}.${input.body}`).digest();
  const actual=Buffer.from(input.signature.slice(3),'hex');
  return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
