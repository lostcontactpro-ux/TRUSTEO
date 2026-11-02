import { createHmac } from 'node:crypto';
import { describe,expect,it } from 'vitest';
import { validGatewaySignature } from './signature';

describe('generic inbound gateway signatures',()=>{
  const secret='a-secure-test-secret-at-least-32-characters';
  const timestamp='1793620800';const now=Number(timestamp)*1000;const id='gateway_123';const body='{"text":"Authentic notification"}';
  const signature=`v1=${createHmac('sha256',secret).update(`${id}.${timestamp}.${body}`).digest('hex')}`;
  const input={id,timestamp,signature,body,secret,now};
  it('accepts the exact authenticated payload',()=>{expect(validGatewaySignature(input)).toBe(true)});
  it('rejects modified content, message IDs and timestamps',()=>{
    expect(validGatewaySignature({...input,body:'{"text":"Forged"}'})).toBe(false);
    expect(validGatewaySignature({...input,id:'gateway_124'})).toBe(false);
    expect(validGatewaySignature({...input,timestamp:String(Number(timestamp)+1)})).toBe(false);
  });
  it('rejects expired requests, weak secrets and invalid signature shapes',()=>{
    expect(validGatewaySignature({...input,now:now+301000})).toBe(false);
    expect(validGatewaySignature({...input,now:now-301000})).toBe(false);
    expect(validGatewaySignature({...input,secret:'short'})).toBe(false);
    expect(validGatewaySignature({...input,signature:'v1=wrong'})).toBe(false);
  });
});
