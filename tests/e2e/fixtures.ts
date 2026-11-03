import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { expect, type APIRequestContext } from '@playwright/test';
export const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
export const password = 'Trusteo-test-password-2026!';
export const createdUserIds: string[] = [];
export function identity() { return { firstName: 'Camille', lastName: 'E2E', email: `e2e-${randomUUID()}@example.test`, password, consent: true }; }
export function headers(baseURL: string) { return { origin: new URL(baseURL).origin, 'content-type': 'application/json' }; }
export async function signUp(request: APIRequestContext, baseURL: string) {
  const person = identity();
  const response = await request.post('/api/auth/signup', { headers: headers(baseURL), data: person });
  expect(response.status(), await response.text()).toBe(201);
  const { user } = await response.json();
  createdUserIds.push(user.id);
  return { ...person, id: user.id };
}
/** Explicit local integration fixture: this does not exercise Stripe or grant an actual paid subscription. */
export async function trialFixture(userId: string) {
  return database.subscription.update({ where: { userId }, data: { plan: 'essential', status: 'trialing', trialEndsAt: new Date(Date.now() + 14 * 86_400_000), currentPeriodEnd: new Date(Date.now() + 14 * 86_400_000), trialUsed: true } });
}
export async function locationFixture(userId: string) {
  return database.location.create({ data: { userId, name: 'Le Bistro — fixture E2E', address: '10 rue des Tests', city: 'Paris', reviewUrl: 'https://example.com/reviews/test-fixture' } });
}
export async function reviewFixture(userId: string) {
  const location = await locationFixture(userId);
  const connection = await database.providerConnection.create({ data: { locationId: location.id, platform: 'custom', mode: 'assisted', status: 'assisted' } });
  const review = await database.review.create({ data: { connectionId: connection.id, locationId: location.id, externalId: `fixture-${randomUUID()}`, platform: 'custom', author: 'Client fictif — test automatisé', rating: 2, text: 'Avis synthétique réservé au test : attente trop longue.', publishedAt: new Date(), sourceUrl: 'https://example.com/reviews/test-fixture' } });
  return { location, connection, review };
}
export async function cleanup() {
  if (createdUserIds.length) await database.user.deleteMany({ where: { id: { in: createdUserIds.splice(0) }, email: { startsWith: 'e2e-', endsWith: '@example.test' } } });
}
