import { test, expect } from '@playwright/test';
import { cleanup, createdUserIds, database, headers, identity, password, reviewFixture, signUp, trialFixture, locationFixture } from './fixtures';

test.afterEach(async () => { await cleanup(); });
test.afterAll(async () => { await database.$disconnect(); });

test('inscription mobile → essai fixture → connexion → réponse assistée sans publication fictive', async ({ page, context, baseURL }) => {
  const person = identity();
  await page.goto('/signup');
  await page.getByLabel('Prénom', { exact: true }).fill(person.firstName);
  await page.getByLabel('Nom', { exact: true }).fill(person.lastName);
  await page.getByLabel('Adresse email', { exact: true }).fill(person.email);
  await page.getByRole('button', { name: 'Continuer', exact: true }).click();
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continuer', exact: true }).click();
  await expect(page.getByText('Un essai, sans surprise.')).toBeVisible();
  // The account is created through the real API; only external Checkout is isolated.
  await page.route('**/api/billing/checkout', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Paiement externe isolé pour ce test.' }) }));
  await page.getByRole('button', { name: 'Démarrer mon essai sur Stripe' }).click();
  await expect(page.getByRole('alert').filter({hasText:'Paiement externe isolé'})).toContainText('Paiement externe isolé');
  const user = await database.user.findUniqueOrThrow({ where: { email: person.email }, include: { subscription: true } });
  createdUserIds.push(user.id);
  expect(user.subscription?.status).toBe('incomplete');
  expect(user.passwordHash).not.toContain(password);
  const cookie = (await context.cookies()).find(item => item.name === 'trusteo_session');
  expect(cookie?.httpOnly).toBe(true); expect(cookie?.sameSite).toBe('Lax');
  expect(await database.session.count({ where: { userId: user.id, tokenHash: cookie?.value } })).toBe(0);

  await trialFixture(user.id); // Explicit local integration fixture, never a payment assertion.
  const { review } = await reviewFixture(user.id);
  await page.request.post('/api/auth/logout', { headers: headers(baseURL!), data: {} });
  await page.goto('/login');
  await page.getByLabel('Adresse email', { exact: true }).fill(person.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Me connecter', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto('/app/reviews');
  await expect(page.getByRole('heading', { name: review.author })).toBeVisible();
  await expect(page.getByText('Prioritaire', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Votre réponse', { exact: true })).toBeVisible();
  await page.getByLabel('Votre réponse', { exact: true }).fill('Merci pour votre retour. Nous allons revoir notre organisation pour réduire l’attente.');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Préparer la publication manuelle', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(/copiée/i);
  const persisted = await database.review.findUniqueOrThrow({ where: { id: review.id } });
  expect(persisted.repliedAt).toBeNull();
  expect(persisted.status).not.toBe('replied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Merci pour votre retour');
  for (const path of ['/app', '/app/reviews', '/app/locations', '/app/settings']) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.getByLabel('Prénom', { exact: true }).fill('Camille modifiée');
  await page.getByRole('button', { name: 'Enregistrer mon profil', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Profil mis à jour.');
  expect((await database.user.findUniqueOrThrow({ where: { id: user.id } })).firstName).toBe('Camille modifiée');
});

test('sessions, CSRF, isolation entre comptes et limite du plan côté serveur', async ({ request, playwright, baseURL }) => {
  const account = await signUp(request, baseURL!);
  const noTrial = await request.post('/api/locations', { headers: headers(baseURL!), data: { name: 'Sans essai', address: '1 rue des Tests', city: 'Paris' } });
  expect(noTrial.ok()).toBe(false);
  expect(await database.location.count({ where: { userId: account.id } })).toBe(0);
  await trialFixture(account.id);
  const victim = await locationFixture(account.id);
  const attackerContext = await playwright.request.newContext({ baseURL });
  const attacker = await signUp(attackerContext, baseURL!);
  const hijack = await attackerContext.patch(`/api/locations/${victim.id}`, { headers: headers(baseURL!), data: { name: 'Compte attaquant' } });
  expect(hijack.status()).toBe(404);
  expect((await database.location.findUniqueOrThrow({ where: { id: victim.id } })).name).toBe(victim.name);
  const exported = await attackerContext.get('/api/account/export');
  expect(await exported.text()).not.toContain(account.email);
  await attackerContext.dispose();
  const csrf = await request.post('/api/locations', { headers: { ...headers(baseURL!), origin: 'https://evil.example' }, data: { name: 'CSRF', address: '1 rue des Tests', city: 'Paris' } });
  expect(csrf.status()).toBe(403);
  for (let n = 0; n < 2; n++) {
    const added = await request.post('/api/locations', { headers: headers(baseURL!), data: { name: `Bistro ${n}`, address: '1 rue des Tests', city: 'Paris' } });
    expect(added.status(), await added.text()).toBe(201);
  }
  const overLimit = await request.post('/api/locations', { headers: headers(baseURL!), data: { name: 'Un quatrième établissement', address: '1 rue des Tests', city: 'Paris' } });
  expect(overLimit.ok()).toBe(false);
  expect(await database.location.count({ where: { userId: account.id } })).toBe(3);
  const forbiddenDelete = await request.delete(`/api/locations/${(await locationFixture(attacker.id)).id}`, { headers: headers(baseURL!), data: {} });
  expect(forbiddenDelete.status()).toBe(404);
  const invalidLogin = await request.post('/api/auth/login', { headers: headers(baseURL!), data: { email: account.email, password: 'incorrect-password' } });
  expect(invalidLogin.status()).toBe(401);
});

test('consentement obligatoire, désinscription conservée, promotions indépendantes et à usage unique', async ({ request, baseURL }) => {
  const account = await signUp(request, baseURL!);
  await trialFixture(account.id);
  const location = await locationFixture(account.id);
  const contact = { email: `client-${account.id}@example.test`, name: 'Client réel attesté', consent: true, consentSource: 'Consentement boutique — fixture E2E' };
  const rejected = await request.post('/api/contacts', { headers: headers(baseURL!), data: { contacts: [{ ...contact, consent: false }] } });
  expect(rejected.status()).toBe(400);
  const imported = await request.post('/api/contacts', { headers: headers(baseURL!), data: { contacts: [contact] } });
  expect(imported.status()).toBe(201);
  const saved = await database.contact.findUniqueOrThrow({ where: { userId_email: { userId: account.id, email: contact.email } } });
  const link = await request.get(`/api/unsubscribe?token=${saved.unsubscribeToken}`);
  expect(link.ok()).toBe(true);
  expect((await database.contact.findUniqueOrThrow({ where: { id: saved.id } })).unsubscribedAt).toBeNull();
  await request.post('/api/unsubscribe', { data: { token: saved.unsubscribeToken } });
  await request.post('/api/contacts', { headers: headers(baseURL!), data: { contacts: [contact] } });
  expect((await database.contact.findUniqueOrThrow({ where: { id: saved.id } })).unsubscribedAt).not.toBeNull();
  const conditional = await request.post('/api/campaigns', { headers: headers(baseURL!), data: { name: 'Campagne non conforme', locationId: location.id, message: 'Merci de votre visite !', offer: '-10% contre un avis' } });
  expect(conditional.status()).toBe(400);
  const neutral = await request.post('/api/campaigns', { headers: headers(baseURL!), data: { name: 'Invitation neutre', locationId: location.id, message: 'Merci de votre visite !' } });
  expect(neutral.status()).toBe(201);
  const noAttestation = await request.put('/api/referrals', { headers: headers(baseURL!), data: { contactId: saved.id, purchaseReference: 'achat-1', purchaseVerified: false } });
  expect(noAttestation.status()).toBe(400);
  const issued = await request.put('/api/referrals', { headers: headers(baseURL!), data: { contactId: saved.id, purchaseReference: 'achat-1', purchaseVerified: true } });
  expect(issued.status(), await issued.text()).toBe(201);
  const { promotion } = await issued.json();
  expect(promotion.discountPercent).toBe(10);
  expect(await database.review.count({ where: { locationId: location.id } })).toBe(0);
  const duplicate = await request.put('/api/referrals', { headers: headers(baseURL!), data: { contactId: saved.id, purchaseReference: 'achat-autre', purchaseVerified: true } });
  expect(duplicate.status()).toBe(409);
  const originalPurchase = await request.post('/api/referrals/redeem', { headers: headers(baseURL!), data: { code: promotion.code, purchaseReference: 'achat-1', purchaseVerified: true } });
  expect(originalPurchase.status()).toBe(409);
  const redemptions = await Promise.all([1, 2].map(n => request.post('/api/referrals/redeem', { headers: headers(baseURL!), data: { code: promotion.code, purchaseReference: `achat-suivant-${n}`, purchaseVerified: true } })));
  expect(redemptions.map(response => response.status()).sort()).toEqual([200, 409]);
});

test('services externes absents : erreur explicite, aucun paiement ni brouillon IA inventé', async ({ request, baseURL }) => {
  const account = await signUp(request, baseURL!);
  const payment = await request.post('/api/billing/checkout', { headers: headers(baseURL!), data: { plan: 'essential', interval: 'month' } });
  expect(payment.status()).toBe(503);
  expect((await database.subscription.findUniqueOrThrow({ where: { userId: account.id } })).status).toBe('incomplete');
  await trialFixture(account.id);
  const { review } = await reviewFixture(account.id);
  const ai = await request.post(`/api/reviews/${review.id}/drafts`, { headers: headers(baseURL!), data: {} });
  expect(ai.status()).toBe(503);
  expect(await database.replyDraft.count({ where: { reviewId: review.id } })).toBe(0);
});

test('suppression du compte refusée pendant Checkout ou abonnement actif, puis atomique après annulation', async ({ request, baseURL }) => {
  const account = await signUp(request, baseURL!);
  await database.subscription.update({ where: { userId: account.id }, data: { checkoutSessionId: 'cs_fixture_open', checkoutExpiresAt: new Date(Date.now() + 3_600_000) } });
  const openCheckout = await request.delete('/api/account', { headers: headers(baseURL!), data: { password, confirmation: 'SUPPRIMER' } });
  expect(openCheckout.status()).toBe(409);
  expect(await database.user.count({ where: { id: account.id } })).toBe(1);
  expect((await request.get('/api/auth/me')).ok()).toBe(true);
  await database.subscription.update({ where: { userId: account.id }, data: { checkoutSessionId: null, checkoutExpiresAt: null, stripeSubscriptionId: `sub_fixture_${account.id}`, status: 'active' } });
  const activeSubscription = await request.delete('/api/account', { headers: headers(baseURL!), data: { password, confirmation: 'SUPPRIMER' } });
  expect(activeSubscription.status()).toBe(409);
  expect(await database.user.count({ where: { id: account.id } })).toBe(1);
  await database.subscription.update({ where: { userId: account.id }, data: { status: 'canceled' } });
  const canceled = await request.delete('/api/account', { headers: headers(baseURL!), data: { password, confirmation: 'SUPPRIMER' } });
  expect(canceled.status()).toBe(200);
  expect(await database.user.count({ where: { id: account.id } })).toBe(0);
  expect(await database.session.count({ where: { userId: account.id } })).toBe(0);
  expect((await request.get('/api/auth/me')).status()).toBe(401);
});

test('rétrogradation au-delà du plafond : opérations bloquées, lecture et suppression disponibles', async ({ request, baseURL }) => {
  const account = await signUp(request, baseURL!);
  await trialFixture(account.id);
  const { review, location, connection } = await reviewFixture(account.id);
  for (let n = 0; n < 3; n++) await locationFixture(account.id);
  expect(await database.location.count({ where: { userId: account.id } })).toBe(4);
  for (const [action, data] of [['drafts', {}], ['improve', { text: 'Merci pour ce retour utile.' }], ['reply', { text: 'Merci pour votre retour.' }]] as const) {
    const response = await request.post(`/api/reviews/${review.id}/${action}`, { headers: headers(baseURL!), data });
    expect(response.status(), await response.text()).toBe(403);
  }
  const campaign = await database.campaign.create({ data: { userId: account.id, locationId: location.id, name: 'Campagne après rétrogradation', message: 'Merci de votre visite !' } });
  expect((await request.post(`/api/campaigns/${campaign.id}/send`, { headers: headers(baseURL!), data: {} })).status()).toBe(403);
  expect((await request.post(`/api/connections/${connection.id}/sync`, { headers: headers(baseURL!), data: {} })).status()).toBe(403);
  const list = await request.get('/api/locations');
  expect(list.status()).toBe(200);
  expect((await list.json()).locations).toHaveLength(4);
  expect((await request.get('/api/reviews')).status()).toBe(200);
  const extra = await database.location.findFirstOrThrow({ where: { userId: account.id, id: { not: location.id } } });
  expect((await request.delete(`/api/locations/${extra.id}`, { headers: headers(baseURL!), data: {} })).status()).toBe(200);
  // With capacity restored, the request reaches the external configuration check.
  expect((await request.post(`/api/reviews/${review.id}/drafts`, { headers: headers(baseURL!), data: {} })).status()).toBe(503);
});
