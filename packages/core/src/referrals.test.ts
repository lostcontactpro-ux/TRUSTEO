import { describe,it,expect } from 'vitest';
import { canRedeem,loyaltyInput,redemptionInput,LOYALTY_DISCOUNT_PERCENT } from './referrals';
describe('fidélité indépendante des avis',()=>{
 it('exige une attestation d’achat réel et aucun avis',()=>{expect(loyaltyInput.safeParse({contactId:'c',purchaseReference:'ticket-123',purchaseVerified:true}).success).toBe(true);expect(loyaltyInput.safeParse({contactId:'c',purchaseReference:'ticket-123'}).success).toBe(false);expect(LOYALTY_DISCOUNT_PERCENT).toBe(10)});
 it('refuse double usage, expiration et réutilisation ticket initial',()=>{const now=new Date('2026-01-01');const p={redeemedAt:null,expiresAt:new Date('2026-02-01'),purchaseReference:'ticket-1'};expect(canRedeem(p,'ticket-2',now)).toBe(true);expect(canRedeem(p,'ticket-1',now)).toBe(false);expect(canRedeem({...p,redeemedAt:now},'ticket-2',now)).toBe(false);expect(canRedeem({...p,expiresAt:now},'ticket-2',now)).toBe(false)});
 it('refuse les codes faciles à deviner',()=>{expect(redemptionInput.safeParse({code:'abc',purchaseReference:'ticket-2',purchaseVerified:true}).success).toBe(false)});
});
