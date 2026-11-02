import { z } from 'zod';
export const LOYALTY_DISCOUNT_PERCENT = 10;
export const LOYALTY_VALIDITY_DAYS = 90;
export const referralInput = z.object({contactId:z.string().min(1).max(100),referredEmail:z.email().max(254).transform(v=>v.toLowerCase()).optional()});
export const loyaltyInput = z.object({contactId:z.string().min(1).max(100),purchaseReference:z.string().trim().min(3).max(120),purchaseVerified:z.literal(true)});
export const redemptionInput = z.object({code:z.string().min(16).max(128),purchaseReference:z.string().trim().min(3).max(120),purchaseVerified:z.literal(true)});
export function canRedeem(promotion:{redeemedAt:Date|null;expiresAt:Date;purchaseReference:string},newPurchase:string,now=new Date()):boolean {
  return !promotion.redeemedAt && promotion.expiresAt>now && promotion.purchaseReference!==newPurchase;
}
