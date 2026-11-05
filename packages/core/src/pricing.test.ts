import { describe, expect, it } from 'vitest';
import { amountFor, annualSavings, hasAnnualBenefits, paymentLinkFor, paymentLinks, assertLocationCapacity, canAddLocation, canOperateLocations, isEntitled, locationLimit, pricing } from './pricing';
const now = new Date('2026-01-01T00:00:00Z');
const active = { plan: 'essential', status: 'active', currentPeriodEnd: new Date('2026-02-01') };
describe('pricing and server entitlements', () => {
  it('uses exact prices in integer cents', () => {
    expect(amountFor('essential', 'month')).toBe(4980);
    expect(amountFor('essential', 'year')).toBe(40900);
    expect(amountFor('pro', 'month')).toBe(10900);
    expect(amountFor('pro', 'year')).toBe(98000);
    expect(pricing.trialDays).toBe(14);
  });
  it('enforces exact plan boundaries', () => {
    expect(canAddLocation(active, 2, now)).toBe(true);
    expect(canAddLocation(active, 3, now)).toBe(false);
    expect(canAddLocation({ ...active, plan: 'pro' }, 19, now)).toBe(true);
    expect(canAddLocation({ ...active, plan: 'pro' }, 20, now)).toBe(false);
    expect(() => assertLocationCapacity(active, 3, now)).toThrow();
  });
  it('does not grant access on signup, expiry, or failed payment', () => {
    for (const status of ['incomplete', 'incomplete_expired', 'past_due', 'unpaid', 'canceled', 'paused']) {
      expect(isEntitled({ ...active, status }, now)).toBe(false);
    }
    expect(isEntitled({ ...active, currentPeriodEnd: now }, now)).toBe(false);
    expect(locationLimit(null, now)).toBe(0);
    expect(isEntitled({ ...active, currentPeriodEnd: null }, now)).toBe(false);
  });
  it('blocks billable operations after downgrade until excess locations are removed', () => {
    expect(canOperateLocations(active, 3, now)).toBe(true);
    expect(canOperateLocations(active, 4, now)).toBe(false);
    expect(canOperateLocations({ ...active, plan: 'pro' }, 20, now)).toBe(true);
    expect(canOperateLocations({ ...active, plan: 'pro' }, 21, now)).toBe(false);
    expect(canOperateLocations({ ...active, plan: 'unknown' }, 0, now)).toBe(false);
    expect(canOperateLocations({ ...active, status: 'past_due' }, 1, now)).toBe(false);
    expect(canOperateLocations(active, -1, now)).toBe(false);
  });
  it('validates trial expiration independently of paid period', () => {
    expect(isEntitled({ ...active, status: 'trialing', trialEndsAt: new Date('2026-01-15') }, now)).toBe(true);
    expect(isEntitled({ ...active, status: 'trialing', trialEndsAt: now }, now)).toBe(false);
  });
  it('requires explicit enterprise limits and rejects malformed counts', () => {
    expect(locationLimit({ ...active, plan: 'enterprise' }, now)).toBe(0);
    expect(locationLimit({ ...active, plan: 'unknown' }, now)).toBe(0);
    expect(locationLimit({ ...active, plan: 'enterprise', enterpriseLocationLimit: 80 }, now)).toBe(80);
    expect(canAddLocation(active, -1, now)).toBe(false);
    expect(canAddLocation(active, 1.1, now)).toBe(false);
  });
});


describe('annual pricing and direct Stripe links', () => {
  it('routes each plan and cadence to its exact public Payment Link', () => {
    expect(paymentLinkFor('essential', 'month')).toBe('https://buy.stripe.com/14A3cv2Fn5Up4ssg3Zes004');
    expect(paymentLinkFor('essential', 'year')).toBe('https://buy.stripe.com/eVqfZh4Nv1E95ww3hdes002');
    expect(paymentLinkFor('pro', 'month')).toBe('https://buy.stripe.com/14AdR9gwdfuZbUU8Bxes003');
    expect(paymentLinkFor('pro', 'year')).toBe('https://buy.stripe.com/6oUbJ193L4Qlf765ples001');
    expect(new Set(Object.values(paymentLinks).flatMap(cadences => Object.values(cadences))).size).toBe(4);
  });
  it('calculates savings against twelve full-price months without stacking the introductory discount', () => {
    expect(annualSavings('essential')).toEqual({fullPriceMonthlyTotalCents:59760,annualPriceCents:40900,savingsCents:18860,percent:31.6,monthlyEquivalentCents:3408});
    expect(annualSavings('pro')).toEqual({fullPriceMonthlyTotalCents:130800,annualPriceCents:98000,savingsCents:32800,percent:25.1,monthlyEquivalentCents:8167});
  });
  it('keeps annual extras only for paid, nonexpired annual access', () => {
    const annual={...active,interval:'year',cancelAtPeriodEnd:true};
    expect(hasAnnualBenefits(annual,now)).toBe(true);
    expect(hasAnnualBenefits({...annual,interval:'month'},now)).toBe(false);
    expect(hasAnnualBenefits({...annual,currentPeriodEnd:now},now)).toBe(false);
    expect(hasAnnualBenefits({...annual,currentPeriodEnd:null},now)).toBe(false);
    expect(hasAnnualBenefits({...annual,status:'trialing',trialEndsAt:new Date('2026-01-15')},now)).toBe(false);
    for(const status of ['past_due','canceled','incomplete','unpaid','paused'])expect(hasAnnualBenefits({...annual,status},now)).toBe(false);
    expect(hasAnnualBenefits(null,now)).toBe(false);
    expect(hasAnnualBenefits(undefined,now)).toBe(false);
  });
});
