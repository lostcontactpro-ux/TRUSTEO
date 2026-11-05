import { expect, test } from '@playwright/test';
import { paymentLinkFor } from '../../packages/core/src/pricing';
import { claimMonthlyTrial, canOfferMonthlyTrial } from '../../apps/web/src/lib/trial-eligibility';
import { cleanup, createdUserIds, database, headers, identity, password, signUp, trialFixture } from './fixtures';

test.afterAll(async () => { await cleanup(); await database.$disconnect(); });

test('tarifs mobiles : quatre destinations Stripe exactes et annuel sans essai', async ({ page }) => {
  await page.goto('/pricing');
  const essential = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Essentiel', exact: true }) });
  const pro = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Pro', exact: true }) });
  await expect(essential.getByRole('link', { name: 'S’abonner à l’année — Essentiel' })).toHaveAttribute('href', paymentLinkFor('essential', 'year'));
  await expect(pro.getByRole('link', { name: 'S’abonner à l’année — Pro' })).toHaveAttribute('href', paymentLinkFor('pro', 'year'));
  await expect(essential.getByText(/Économisez 188,60/)).toBeVisible();
  await expect(pro.getByText(/Économisez 328/)).toBeVisible();
  await expect(essential.getByText('Sans période d’essai.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Mensuel', exact: true }).click();
  await expect(essential.getByRole('link', { name: 'Choisir le mensuel — Essentiel' })).toHaveAttribute('href', paymentLinkFor('essential', 'month'));
  await expect(pro.getByRole('link', { name: 'Choisir le mensuel — Pro' })).toHaveAttribute('href', paymentLinkFor('pro', 'month'));
  await expect(page.getByText(/L’essai de 14 jours et la remise/)).toBeVisible();
});

test('inscription annuelle : paiement immédiat annoncé et cadence annuelle conservée', async ({ page }) => {
  const person = identity();
  await page.goto('/signup?plan=pro&interval=year');
  await expect(page.getByText(/Votre abonnement annuel commence au paiement/)).toBeVisible();
  await page.getByLabel('Prénom', { exact: true }).fill(person.firstName);
  await page.getByLabel('Nom', { exact: true }).fill(person.lastName);
  await page.getByLabel('Adresse email', { exact: true }).fill(person.email);
  await page.getByRole('button', { name: 'Continuer', exact: true }).click();
  await page.getByLabel('Mot de passe', { exact: true }).fill(person.password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continuer', exact: true }).click();
  await expect(page.getByText('Une année pour votre réputation.', { exact: true })).toBeVisible();
  await expect(page.getByText('Un essai, sans surprise.', { exact: true })).toHaveCount(0);
  await page.route('**/api/billing/checkout', async route => {
    expect(route.request().postDataJSON()).toEqual({ plan: 'pro', interval: 'year' });
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Paiement Stripe isolé pour ce test.' }) });
  });
  await page.getByRole('button', { name: 'Continuer sur Stripe', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Paiement Stripe isolé' })).toContainText('Paiement Stripe isolé');
  const user = await database.user.findUniqueOrThrow({ where: { email: person.email } });
  createdUserIds.push(user.id);
});

test('annulation mobile : la case seule est inerte, confirmation et accès conservé', async ({ page, request, baseURL }) => {
  const user = await signUp(request, baseURL!);
  await trialFixture(user.id);
  // Browser and API fixtures share the same signed session, not a fake auth UI.
  await page.context().addCookies((await request.storageState()).cookies);
  let cancellations = 0;
  const end = new Date(Date.now() + 10 * 86400_000).toISOString();
  await page.route('**/api/billing/cancel', async route => {
    cancellations++;
    expect(route.request().postDataJSON()).toEqual({ confirm: true });
    await database.subscription.update({ where: { userId: user.id }, data: { cancelAtPeriodEnd: true } });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cancelAtPeriodEnd: true, trialEndsAt: end, currentPeriodEnd: end }) });
  });
  await page.goto('/app/settings');
  const card = page.getByRole('region', { name: 'Annuler mon abonnement', exact: true });
  const confirm = card.getByRole('button', { name: 'Confirmer l’annulation à échéance', exact: true });
  await expect(confirm).toBeDisabled();
  await card.getByRole('checkbox').check();
  await expect(confirm).toBeEnabled();
  expect(cancellations).toBe(0);
  await confirm.click();
  await expect(page.getByRole('status')).toContainText('Annulation confirmée');
  await expect(card.getByText('Renouvellement désactivé.', { exact: true })).toBeVisible();
  expect(cancellations).toBe(1);
  expect((await database.subscription.findUniqueOrThrow({ where: { userId: user.id } })).status).toBe('trialing');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('paiement déjà effectué : preuve conservée vers connexion, aucun second Checkout', async ({ page }) => {
  const person = identity();
  const paymentToken = 'a'.repeat(64); // Synthetic token, no actual Stripe payment.
  let checkouts = 0;
  await page.route('**/api/billing/checkout', async route => { checkouts++; await route.abort(); });
  await page.route('**/api/billing/claim', async route => {
    expect(route.request().postDataJSON()).toEqual({ token: paymentToken });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ claimed: true, plan: 'essential', interval: 'year', status: 'active' }) });
  });
  await page.goto(`/signup?paymentToken=${paymentToken}`);
  await expect(page.getByRole('link', { name: 'Se connecter', exact: true })).toHaveAttribute('href', `/login?paymentToken=${paymentToken}`);
  await page.getByLabel('Prénom', { exact: true }).fill(person.firstName);
  await page.getByLabel('Nom', { exact: true }).fill(person.lastName);
  await page.getByLabel('Adresse email', { exact: true }).fill(person.email);
  await page.getByRole('button', { name: 'Continuer', exact: true }).click();
  await page.getByLabel('Mot de passe', { exact: true }).fill(person.password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continuer', exact: true }).click();
  await expect(page.getByText('Rattacher mon paiement', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Activer mon accès', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/settings\?payment=linked$/);
  const user = await database.user.findUniqueOrThrow({ where: { email: person.email } });
  createdUserIds.push(user.id);
  expect(checkouts).toBe(0);
});

test('registre PostgreSQL : deux comptes avec la même carte ne reçoivent pas deux essais, même après suppression', async ({ request, baseURL }) => {
  const user = await signUp(request, baseURL!);
  const stamp = user.id;
  const subscriptionIds = [`sub_e2e_first_${stamp}`, `sub_e2e_second_${stamp}`];
  const cardFingerprint = `card_e2e_${stamp}`; // Registry fixture, no banking call.
  try {
    const results = await Promise.all(subscriptionIds.map((stripeSubscriptionId, index) => claimMonthlyTrial({
      stripeSubscriptionId, email: index === 0 ? user.email : `another-${stamp}@example.test`,
      cardFingerprint, interval: 'month', hasTrial: true,
    })));
    expect(results.filter(result => result.allowed)).toHaveLength(1);
    expect(results.filter(result => !result.allowed && result.reason === 'identity_used')).toHaveLength(1);
    const winner = results.findIndex(result => result.allowed);
    const winningEmail = winner === 0 ? user.email : `another-${stamp}@example.test`;
    expect((await claimMonthlyTrial({ stripeSubscriptionId: subscriptionIds[winner], email: winningEmail, cardFingerprint, interval: 'month', hasTrial: true })).allowed).toBe(true);
    expect(await canOfferMonthlyTrial({ email: winningEmail })).toBe(false);
    expect(await canOfferMonthlyTrial({ email: `third-${stamp}@example.test`, cardFingerprint })).toBe(false);
    const deleted = await request.delete('/api/account', { headers: headers(baseURL!), data: { password, confirmation: 'SUPPRIMER' } });
    expect(deleted.status()).toBe(200);
    // User deletion deliberately cannot erase the card/email trial identity.
    expect(await database.trialUsage.count({ where: { stripeSubscriptionId: { in: subscriptionIds } } })).toBe(1);
    expect(await canOfferMonthlyTrial({ email: winningEmail })).toBe(false);
  } finally {
    await database.trialUsage.deleteMany({ where: { stripeSubscriptionId: { in: subscriptionIds } } });
  }
});
