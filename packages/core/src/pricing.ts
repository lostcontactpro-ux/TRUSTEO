/** Single source of truth: all amounts are integer EUR cents. */
export const pricing = {
  currency: 'eur',
  trialDays: 14,
  introductoryDiscount: { percent: 20, months: 2, interval: 'month' },
  essential: { name: 'Essentiel', monthly: 4_980, yearly: 40_900, minLocations: 1, maxLocations: 3 },
  pro: { name: 'Pro', monthly: 10_900, yearly: 98_000, minLocations: 3, maxLocations: 20 },
  enterprise: { name: 'Entreprise', monthly: null, yearly: null, minLocations: 1, maxLocations: null },
} as const;

export type Plan = 'essential' | 'pro' | 'enterprise';
export type BillingInterval = 'month' | 'year';
export type SelfServePlan = Exclude<Plan, 'enterprise'>;

/** Public Stripe Payment Links supplied by the merchant; never secret keys. */
export const paymentLinks = {
  essential: {
    month: 'https://buy.stripe.com/14A3cv2Fn5Up4ssg3Zes004',
    year: 'https://buy.stripe.com/eVqfZh4Nv1E95ww3hdes002',
  },
  pro: {
    month: 'https://buy.stripe.com/14AdR9gwdfuZbUU8Bxes003',
    year: 'https://buy.stripe.com/6oUbJ193L4Qlf765ples001',
  },
} as const;

export function paymentLinkFor(plan: SelfServePlan, interval: BillingInterval): string {
  return paymentLinks[plan][interval];
}

/** Comparison against twelve full-price monthly payments, before introductory
 * discounts. The monthly equivalent is indicative; the annual total is charged. */
export function annualSavings(plan: SelfServePlan) {
  const fullPriceMonthlyTotalCents = pricing[plan].monthly * 12;
  const annualPriceCents = pricing[plan].yearly;
  const savingsCents = fullPriceMonthlyTotalCents - annualPriceCents;
  return {
    fullPriceMonthlyTotalCents,
    annualPriceCents,
    savingsCents,
    percent: Math.round(savingsCents / fullPriceMonthlyTotalCents * 1000) / 10,
    monthlyEquivalentCents: Math.round(annualPriceCents / 12),
  };
}

export type Entitlement = {
  plan: string;
  status: string;
  interval?: string;
  currentPeriodEnd?: Date | null;
  trialEndsAt?: Date | null;
  enterpriseLocationLimit?: number | null;
};

export function isSelfServePlan(plan: string): plan is Exclude<Plan, 'enterprise'> {
  return plan === 'essential' || plan === 'pro';
}

export function amountFor(plan: Exclude<Plan, 'enterprise'>, interval: BillingInterval): number {
  return interval === 'month' ? pricing[plan].monthly : pricing[plan].yearly;
}

export function formatPrice(cents: number, locale = 'fr-FR'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}

export function isEntitled(subscription: Entitlement | null | undefined, now = new Date()): boolean {
  if (!subscription) return false;
  if (subscription.status === 'trialing') return !!subscription.trialEndsAt && subscription.trialEndsAt > now;
  if (subscription.status === 'active') return !!subscription.currentPeriodEnd && subscription.currentPeriodEnd > now;
  return false;
}

/** Annual extras start with paid annual access. Scheduling cancellation does
 * not remove them before the paid-through date. Annual trials grant no extras. */
export function hasAnnualBenefits(subscription: Entitlement | null | undefined, now = new Date()): boolean {
  return !!subscription && subscription.interval === 'year' && subscription.status === 'active' && isEntitled(subscription, now);
}

export function locationLimit(subscription: Entitlement | null | undefined, now = new Date()): number {
  if (!subscription || !isEntitled(subscription, now)) return 0;
  if (subscription.plan === 'essential') return pricing.essential.maxLocations;
  if (subscription.plan === 'pro') return pricing.pro.maxLocations;
  if (subscription.plan === 'enterprise') {
    const limit = subscription.enterpriseLocationLimit;
    return Number.isSafeInteger(limit) && limit! > 0 ? limit! : 0;
  }
  return 0;
}

export function canAddLocation(subscription: Entitlement | null | undefined, currentCount: number, now = new Date()): boolean {
  return Number.isSafeInteger(currentCount) && currentCount >= 0 && currentCount < locationLimit(subscription, now);
}

export function assertLocationCapacity(subscription: Entitlement | null | undefined, currentCount: number, now = new Date()): void {
  if (!canAddLocation(subscription, currentCount, now)) {
    throw new Error('Votre abonnement ne permet pas d’ajouter cet établissement. Vérifiez votre essai ou changez de formule.');
  }
}

/** Existing data remains readable after downgrade, but billable operations stop
 * until the owner removes excess locations or upgrades the subscription. */
export function canOperateLocations(subscription: Entitlement | null | undefined, currentCount: number, now = new Date()): boolean {
  const limit = locationLimit(subscription, now);
  return limit > 0 && Number.isSafeInteger(currentCount) && currentCount >= 0 && currentCount <= limit;
}
