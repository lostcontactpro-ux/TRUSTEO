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
export type Entitlement = {
  plan: string;
  status: string;
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
