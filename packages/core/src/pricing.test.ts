import { describe, expect, it } from 'vitest';
import { amountFor, assertLocationCapacity, canAddLocation, canOperateLocations, isEntitled, locationLimit, pricing } from './pricing';
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
