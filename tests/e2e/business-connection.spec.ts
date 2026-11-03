import { createHash } from 'node:crypto';
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { cleanup, database, headers, locationFixture, signUp, trialFixture } from './fixtures';

// Deliberately invalid example. Never use a real provider credential in this suite.
const exampleApiKey = 'trusteo_e2e_placeholder_key_not_valid';
const acceptedLabel = 'Je confirme être autorisé à gérer cet établissement et j’accepte de le connecter à mon compte Trusteo.';
const visualToken = 'e'.repeat(64);
const business = {
  platform: 'trustpilot', businessId: 'fixture-business-e2e', name: 'Bistro Démonstration — connexion de test',
  address: '24 rue des Fixtures, 75001 Paris', website: 'https://fixture.example.test',
  sourceUrl: 'https://fr.trustpilot.com/review/fixture.example.test', rating: 4.6, reviewCount: 42,
  authMethod: 'apiKey', managementVerified: false,
  reviews: [{ externalId: 'fixture-review-connection', platform: 'trustpilot', locationId: '', author: 'Client de démonstration', rating: 4,
    text: 'Exemple de retour client réservé au test visuel.', language: 'fr', publishedAt: '2026-11-01T10:00:00.000Z',
    responseStatus: 'pending', sourceUrl: 'https://fr.trustpilot.com/reviews/fixture-review-connection' }],
};
function previewFixture(locationId: string) {
  return { previewToken: visualToken, testedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    preview: { ...business, reviews: business.reviews.map(review => ({ ...review, locationId })) } };
}
async function createPending(request: APIRequestContext, baseURL: string, locationId: string) {
  const result = await request.post('/api/connections', { headers: headers(baseURL), data: { locationId, platform: 'trustpilot', mode: 'api', authMethod: 'apiKey' } });
  expect(result.status(), await result.text()).toBe(201);
  const body = await result.json();
  expect(body.authorizationUrl).toBeFalsy();
  expect(body.connection.status).toBe('pending');
  return body.connection as { id: string; locationId: string; platform: string; status: string };
}
async function beginApiKeyFlow(page: Page, locationId: string) {
  await page.goto('/app/connections');
  await expect(page.getByRole('heading', { name: 'Connecter mon entreprise', exact: true })).toBeVisible();
  await page.getByLabel('Établissement Trusteo', { exact: true }).selectOption(locationId);
  await page.getByLabel('Plateforme d’avis', { exact: true }).selectOption('trustpilot');
  await page.getByLabel('Mode de connexion', { exact: true }).selectOption('api');
  await page.getByLabel('Méthode d’authentification', { exact: true }).selectOption('apiKey');
  await page.getByRole('button', { name: 'Configurer la clé API', exact: true }).click();
  const keyField = page.getByLabel('Clé API Trustpilot', { exact: true });
  await expect(keyField).toHaveAttribute('type', 'password');
  await keyField.fill(exampleApiKey);
  await page.getByLabel('Identifiant d’entreprise Trustpilot', { exact: true }).fill(business.businessId);
}
async function expectCannotConfirm(page: Page) {
  const confirm = page.getByRole('button', { name: 'Confirmer mon entreprise', exact: true });
  if (await confirm.count()) await expect(confirm).toBeDisabled();
  const acceptance = page.getByRole('checkbox', { name: acceptedLabel, exact: true });
  if (await acceptance.count()) await expect(acceptance).toBeDisabled();
}

test.afterEach(async () => { await cleanup(); });
test.afterAll(async () => { await database.$disconnect(); });

test('connexion entreprise à 375 px : aperçu visuel, consentement explicite et clé sans fuite', async ({ page, baseURL }) => {
  const account = await signUp(page.request, baseURL!);
  await trialFixture(account.id);
  const location = await locationFixture(account.id);
  const requestUrls: string[] = [];
  page.on('request', request => requestUrls.push(request.url()));
  let confirmed = false;
  let connectionId = '';
  let previewCalls = 0;
  // Only the external-facing preview/confirmation boundary is visual-fixtured.
  // The initial pending connection and ownership checks use the real server.
  await page.route('**/api/connections/*/preview', async route => {
    const body = route.request().postDataJSON();
    expect(body.apiKey).toBe(exampleApiKey);
    expect(body.businessUnitId).toBe(business.businessId);
    expect(route.request().url()).not.toContain(exampleApiKey);
    connectionId = new URL(route.request().url()).pathname.split('/').at(-2)!;
    previewCalls++;
    await route.fulfill({ json: previewFixture(location.id) });
  });
  await page.route('**/api/connections/*/confirm', async route => {
    expect(route.request().postDataJSON()).toEqual({ previewToken: visualToken, accepted: true });
    confirmed = true;
    await route.fulfill({ json: { connection: { id: connectionId, locationId: location.id, platform: 'trustpilot', mode: 'api', status: 'connected', hasCredentials: true,
      authMethod: 'apiKey', confirmedAt:new Date().toISOString(), capabilities: { canRead: true, canReply: false, realtime: false, requiresPartnership: false } }, syncQueued: false } });
  });
  // Reflect only the mocked visual confirmation when the component reloads its list.
  await page.route('**/api/connections', async route => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    const response = await route.fetch();
    const body = await response.json();
    if (confirmed) body.connections = body.connections.map((connection: { id: string }) => connection.id === connectionId ? { ...connection, status: 'connected', hasCredentials: true, authMethod: 'apiKey', confirmedAt:new Date().toISOString(), capabilities: { canRead: true, canReply: false, realtime: false, requiresPartnership: false } } : connection);
    await route.fulfill({ response, json: body });
  });
  await beginApiKeyFlow(page, location.id);
  await expectCannotConfirm(page);
  expect(confirmed).toBe(false);
  await page.getByRole('button', { name: 'Tester ma connexion', exact: true }).click();
  await expect(page.getByRole('heading', { name: business.name, exact: true })).toBeVisible();
  await expect(page.getByText(business.address, { exact: true })).toBeVisible();
  await expect(page.getByText(business.reviews[0].text, { exact: true })).toBeVisible();
  await expect(page.getByText('Lecture seule.', { exact: true }).first()).toBeVisible();
  const accept = page.getByRole('checkbox', { name: acceptedLabel, exact: true });
  const confirm = page.getByRole('button', { name: 'Confirmer mon entreprise', exact: true });
  await expect(accept).not.toBeChecked();
  await expect(confirm).toBeDisabled();
  await accept.check();
  await expect(confirm).toBeEnabled();
  expect(confirmed).toBe(false);
  // Editing the resource must invalidate the previous successful test and receipt.
  await page.getByLabel('Identifiant d’entreprise Trustpilot', { exact: true }).fill('another-fixture-business');
  await expect(page.getByRole('heading', { name: business.name, exact: true })).toHaveCount(0);
  await expectCannotConfirm(page);
  await page.getByLabel('Identifiant d’entreprise Trustpilot', { exact: true }).fill(business.businessId);
  await page.getByRole('button', { name: 'Tester ma connexion', exact: true }).click();
  await expect(page.getByRole('heading', { name: business.name, exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: acceptedLabel, exact: true }).check();
  await page.getByRole('button', { name: 'Confirmer mon entreprise', exact: true }).click();
  await expect.poll(() => confirmed).toBe(true);
  await expect(page.getByText('Connectée · lecture seule', { exact: true })).toBeVisible();
  expect(previewCalls).toBe(2);
  // Mocked UI confirmation never activates an actual provider connection.
  expect((await database.providerConnection.findUniqueOrThrow({ where: { id: connectionId } })).status).toBe('pending');
  const apiList = await page.request.get('/api/connections');
  expect(await apiList.text()).not.toContain(exampleApiKey);
  expect(requestUrls.every(url => !url.includes(exampleApiKey))).toBe(true);
  expect(page.url()).not.toContain(exampleApiKey);
  expect(await page.evaluate(() => JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage) }))).not.toContain(exampleApiKey);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('aperçu expiré affiché comme erreur : aucune activation ni synchronisation fictive', async ({ page, baseURL }) => {
  const account = await signUp(page.request, baseURL!);
  await trialFixture(account.id);
  const location = await locationFixture(account.id);
  await page.route('**/api/connections/*/preview', route => route.fulfill({ json: previewFixture(location.id) }));
  await page.route('**/api/connections/*/confirm', route => route.fulfill({ status: 409, json: { error: 'Ce test de connexion a expiré. Testez à nouveau votre connexion.' } }));
  await beginApiKeyFlow(page, location.id);
  await page.getByRole('button', { name: 'Tester ma connexion', exact: true }).click();
  await expect(page.getByRole('heading', { name: business.name, exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: acceptedLabel, exact: true }).check();
  await page.getByRole('button', { name: 'Confirmer mon entreprise', exact: true }).click();
  await expect(page.getByRole('alert').filter({hasText:'Ce test de connexion a expiré'})).toContainText('Ce test de connexion a expiré');
  const stored = await database.providerConnection.findUniqueOrThrow({ where: { locationId_platform: { locationId: location.id, platform: 'trustpilot' } } });
  expect(stored.status).toBe('pending');
  expect(stored.lastSyncedAt).toBeNull();
  expect(await database.syncLog.count({ where: { connectionId: stored.id } })).toBe(0);
});

test('API réelle : clé seule reste en attente, consentement et preuve requis, isolation propriétaire', async ({ request, playwright, baseURL }) => {
  const owner = await signUp(request, baseURL!);
  await trialFixture(owner.id);
  const location = await locationFixture(owner.id);
  const pending = await createPending(request, baseURL!, location.id);
  const googleKey = await request.post('/api/connections', { headers: headers(baseURL!), data: { locationId: location.id, platform: 'google', mode: 'api', authMethod: 'apiKey' } });
  expect(googleKey.status()).toBe(400);
  expect(await database.providerConnection.count({ where: { locationId: location.id, platform: 'google' } })).toBe(0);
  const invalidToken = 'f'.repeat(64);
  const refusedConsent = await request.post(`/api/connections/${pending.id}/confirm`, { headers: headers(baseURL!), data: { previewToken: invalidToken, accepted: false } });
  expect(refusedConsent.status()).toBe(400);
  const forgedReceipt = await request.post(`/api/connections/${pending.id}/confirm`, { headers: headers(baseURL!), data: { previewToken: invalidToken, accepted: true } });
  expect(forgedReceipt.status()).toBe(409);
  // Expiry is rejected before decryption: this deliberately opaque fixture is
  // never a valid preview or a route to successful activation.
  const expiredToken = 'a'.repeat(64);
  await database.providerConnection.update({ where: { id: pending.id }, data: {
    pendingPreview: 'expired-e2e-fixture-not-a-valid-ciphertext',
    previewTokenHash: createHash('sha256').update(expiredToken).digest('hex'),
    previewExpiresAt: new Date(Date.now() - 60_000),
  } });
  const expired = await request.post(`/api/connections/${pending.id}/confirm`, { headers: headers(baseURL!), data: { previewToken: expiredToken, accepted: true } });
  expect(expired.status()).toBe(409);
  expect((await expired.json()).error).toContain('expiré');
  await database.providerConnection.update({ where: { id: pending.id }, data: { previewExpiresAt: new Date(Date.now() + 60_000) } });
  const crossSite = await request.post(`/api/connections/${pending.id}/confirm`, { headers: { ...headers(baseURL!), origin: 'https://untrusted.example.test' }, data: { previewToken: expiredToken, accepted: true } });
  expect(crossSite.status()).toBe(403);
  const wrongToken = await request.post(`/api/connections/${pending.id}/confirm`, { headers: headers(baseURL!), data: { previewToken: invalidToken, accepted: true } });
  expect(wrongToken.status()).toBe(403);
  const tampered = await request.post(`/api/connections/${pending.id}/confirm`, { headers: headers(baseURL!), data: { previewToken: expiredToken, accepted: true } });
  expect(tampered.status()).toBe(409);
  const anonymous = await playwright.request.newContext({ baseURL });
  expect((await anonymous.post(`/api/connections/${pending.id}/confirm`, { headers: headers(baseURL!), data: { previewToken: invalidToken, accepted: true } })).status()).toBe(401);
  await anonymous.dispose();
  const other = await playwright.request.newContext({ baseURL });
  const attacker = await signUp(other, baseURL!);
  await trialFixture(attacker.id);
  const previewNotOwned = await other.post(`/api/connections/${pending.id}/preview`, { headers: headers(baseURL!), data: { authMethod: 'apiKey', businessUnitId: business.businessId, apiKey: exampleApiKey } });
  expect(previewNotOwned.status()).toBe(404);
  const confirmNotOwned = await other.post(`/api/connections/${pending.id}/confirm`, { headers: headers(baseURL!), data: { previewToken: invalidToken, accepted: true } });
  expect(confirmNotOwned.status()).toBe(404);
  const list = await other.get('/api/connections');
  expect((await list.json()).connections).toEqual([]);
  await other.dispose();
  const ownerList = await request.get('/api/connections');
  const dto = (await ownerList.json()).connections.find((connection: { id: string }) => connection.id === pending.id);
  for (const secretField of ['credentials', 'pendingPreview', 'previewTokenHash', 'previewToken']) expect(dto).not.toHaveProperty(secretField);
  const persisted = await database.providerConnection.findUniqueOrThrow({ where: { id: pending.id } });
  expect(persisted.status).toBe('pending');
  expect(persisted.lastSyncedAt).toBeNull();
  expect(await database.review.count({ where: { connectionId: pending.id } })).toBe(0);
  expect(await database.syncLog.count({ where: { connectionId: pending.id } })).toBe(0);
});
