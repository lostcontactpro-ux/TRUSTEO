import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { paymentLinks, amountFor } from '@trusteo/core/pricing';
import { assertNoAnnualTrial, paymentEmail, selectionFromPaymentLinkUrl, validateSubscriptionPrice, type PaymentSelection } from './payment-link-validation';

vi.mock('./security', () => ({ HttpError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));
const expected: PaymentSelection = { plan: 'essential', interval: 'month' };
const choices: PaymentSelection[] = [expected, { plan: 'essential', interval: 'year' }, { plan: 'pro', interval: 'month' }, { plan: 'pro', interval: 'year' }];
function subscription(selection: PaymentSelection = expected): Stripe.Subscription {
  return { id: 'sub_fixture_only', status: 'active', items: { has_more: false, data: [{ quantity: 1, price: {
    id: 'price_fixture_only', currency: 'eur', unit_amount: amountFor(selection.plan, selection.interval), unit_amount_decimal: String(amountFor(selection.plan, selection.interval)),
    recurring: { interval: selection.interval, interval_count: 1, usage_type: 'licensed' }, billing_scheme: 'per_unit',
  } }] } } as unknown as Stripe.Subscription;
}
beforeEach(() => { for (const { plan, interval } of choices) vi.stubEnv(`STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`, ''); });
afterEach(() => vi.unstubAllEnvs());

describe('allowed public Stripe Payment Links', () => {
  it('maps exactly the four merchant-supplied Payment Link URLs', () => {
    for (const selection of choices) expect(selectionFromPaymentLinkUrl(paymentLinks[selection.plan][selection.interval])).toEqual(selection);
  });
  it.each([
    '', 'https://buy.stripe.com/not-allowed', 'http://buy.stripe.com/14A3cv2Fn5Up4ssg3Zes004',
    `${paymentLinks.essential.month}/`, `${paymentLinks.essential.month}?plan=pro`, `${paymentLinks.essential.month}#pro`,
    'https://buy.stripe.com.attacker.test/14A3cv2Fn5Up4ssg3Zes004', 'https://buy.stripe.com@attacker.test/14A3cv2Fn5Up4ssg3Zes004',
  ])('rejects alternate, modified or attacker-controlled link: %s', value => {
    expect(selectionFromPaymentLinkUrl(value)).toBeNull();
  });
});

describe('subscription price validation', () => {
  it('accepts each correctly priced subscription for its independently verified Payment Link', () => {
    for (const selection of choices) expect(validateSubscriptionPrice(subscription(selection), selection)).toEqual(selection);
  });
  it('requires a server-controlled Price ID without a verified Payment Link', () => {
    expect(() => validateSubscriptionPrice(subscription())).toThrow();
    vi.stubEnv('STRIPE_PRICE_ESSENTIAL_MONTH', 'price_fixture_only');
    expect(validateSubscriptionPrice(subscription())).toEqual(expected);
  });
  it('does not accept arbitrary metadata in place of server price configuration', () => {
    const value = subscription(); value.metadata = { plan: 'essential', interval: 'month', userId: 'victim' };
    expect(() => validateSubscriptionPrice(value)).toThrow();
  });
  it('rejects ambiguous server Price ID mappings', () => {
    vi.stubEnv('STRIPE_PRICE_ESSENTIAL_MONTH', 'price_fixture_only');
    vi.stubEnv('STRIPE_PRICE_PRO_MONTH', 'price_fixture_only');
    expect(() => validateSubscriptionPrice(subscription())).toThrow();
  });
  it('enforces configured Price IDs even for a verified Payment Link when configuration exists', () => {
    vi.stubEnv('STRIPE_PRICE_ESSENTIAL_MONTH', 'price_expected_by_server');
    expect(() => validateSubscriptionPrice(subscription(), expected)).toThrow();
  });
  it.each([0, -1, 2, undefined])('rejects a subscription quantity other than exactly one: %s', quantity => {
    const value = subscription(); value.items.data[0].quantity = quantity;
    expect(() => validateSubscriptionPrice(value, expected)).toThrow();
  });
  it('rejects extra line items and incomplete pagination', () => {
    const multiple = subscription(); multiple.items.data.push(multiple.items.data[0]);
    expect(() => validateSubscriptionPrice(multiple, expected)).toThrow();
    const paginated = subscription(); paginated.items.has_more = true;
    expect(() => validateSubscriptionPrice(paginated, expected)).toThrow();
    const empty = subscription(); empty.items.data = [];
    expect(() => validateSubscriptionPrice(empty, expected)).toThrow();
  });
  it.each([0, 49.8, 4979, 4981, null])('rejects an amount other than the exact integer EUR cents: %s', amount => {
    const value = subscription(); value.items.data[0].price.unit_amount = amount;
    expect(() => validateSubscriptionPrice(value, expected)).toThrow();
  });
  it('rejects wrong currency, decimal amount, interval, interval count, metered and tiered pricing', () => {
    const wrongCurrency = subscription(); wrongCurrency.items.data[0].price.currency = 'usd';
    expect(() => validateSubscriptionPrice(wrongCurrency, expected)).toThrow();
    const decimal = subscription(); decimal.items.data[0].price.unit_amount_decimal = '4980.5';
    expect(() => validateSubscriptionPrice(decimal, expected)).toThrow();
    const wrongInterval = subscription(); wrongInterval.items.data[0].price.recurring!.interval = 'year';
    expect(() => validateSubscriptionPrice(wrongInterval, expected)).toThrow();
    const wrongCount = subscription(); wrongCount.items.data[0].price.recurring!.interval_count = 2;
    expect(() => validateSubscriptionPrice(wrongCount, expected)).toThrow();
    const metered = subscription(); metered.items.data[0].price.recurring!.usage_type = 'metered';
    expect(() => validateSubscriptionPrice(metered, expected)).toThrow();
    const tiered = subscription(); tiered.items.data[0].price.billing_scheme = 'tiered';
    expect(() => validateSubscriptionPrice(tiered, expected)).toThrow();
  });
  it('returns a safe policy error without exposing arbitrary Stripe values', () => {
    const value = subscription(); value.items.data[0].price.id = 'secret-looking-upstream-value';
    try { validateSubscriptionPrice(value); throw new Error('Expected validation error'); }
    catch (error) { expect(error).toMatchObject({ status: 409 }); expect((error as Error).message).not.toContain('secret-looking-upstream-value'); }
  });
});

describe('annual trial policy', () => {
  it('rejects a current annual trial regardless of the source checkout settings', () => {
    const value = subscription({ plan: 'pro', interval: 'year' }); value.status = 'trialing';
    expect(() => assertNoAnnualTrial(value, { plan: 'pro', interval: 'year' })).toThrow();
  });
  it('permits a monthly trial and an already paid annual subscription with historical trial data', () => {
    const monthly = subscription(); monthly.status = 'trialing';
    expect(() => assertNoAnnualTrial(monthly, expected)).not.toThrow();
    const annual = subscription({ plan: 'essential', interval: 'year' }); annual.trial_start = 100; annual.trial_end = 200;
    expect(() => assertNoAnnualTrial(annual, { plan: 'essential', interval: 'year' })).not.toThrow();
  });
});

describe('payment receipt email', () => {
  it('normalizes only the email captured in Checkout customer_details', () => {
    const session = { customer_details: { email: '  Merchant@Example.test  ' }, customer_email: 'attacker@example.test', client_reference_id: 'victim', metadata: { email: 'attacker@example.test' } } as unknown as Stripe.Checkout.Session;
    expect(paymentEmail(session)).toBe('merchant@example.test');
  });
  it.each([null, undefined, '', 'invalid-address', 'a@b\nBcc:attacker@example.test'])('rejects missing or invalid captured email without falling back to metadata: %s', email => {
    const session = { customer_details: { email }, customer_email: 'fallback@example.test', metadata: { email: 'metadata@example.test' } } as unknown as Stripe.Checkout.Session;
    expect(() => paymentEmail(session)).toThrow();
  });
});
