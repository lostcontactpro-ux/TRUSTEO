import { test, expect } from '@playwright/test';

async function assertMobileLayout(page: import('@playwright/test').Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const controls = page.locator('button:visible, select:visible, summary:visible');
  for (const control of await controls.all()) {
    const box = await control.boundingBox();
    expect(box?.height, `Touch target height: ${await control.getAttribute('aria-label') || await control.textContent()}`).toBeGreaterThanOrEqual(44);
    expect(box?.width, `Touch target width: ${await control.getAttribute('aria-label') || await control.textContent()}`).toBeGreaterThanOrEqual(44);
  }
  for (const input of await page.locator('input:visible:not([type="checkbox"]), textarea:visible, select:visible').all()) {
    expect(await input.evaluate(element => Boolean(element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') || (element as HTMLInputElement).labels?.length))).toBe(true);
  }
}

test('site public à 375 px : navigation, contrastes des titres, pages légales et libellés', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.getByText('Témoignages fictifs · exemples')).toBeVisible();
  await assertMobileLayout(page);
  // Global heading defaults must never hide headings on the navy panels.
  for (const heading of await page.locator('#how h2, #how h3, article.bg-navy h2').all()) {
    await expect(heading).toHaveCSS('color', 'rgb(255, 255, 255)');
  }
  await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
  const nav = page.getByRole('navigation', { name: 'Navigation mobile' });
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: 'Tarifs', exact: true }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.locator('h1')).toHaveCount(1);
  await assertMobileLayout(page);
  for (const path of ['/contact', '/legal', '/terms', '/privacy', '/login', '/signup', '/forgot-password']) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    await assertMobileLayout(page);
  }
});

test('FR/EN et choix du tarif conservé dans l’inscription sans achat', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Passer en anglais' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your reputation');
  await assertMobileLayout(page);
  await page.goto('/signup?plan=pro&interval=year');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByLabel('First name', { exact: true }).fill('Camille');
  await page.getByLabel('Last name', { exact: true }).fill('Example');
  await page.getByLabel('Email address', { exact: true }).fill('preview@example.test');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Password', { exact: true }).fill('Preview-password-375');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Your plan', { exact: true })).toHaveValue('pro');
  await expect(page.getByLabel('Billing', { exact: true })).toHaveValue('year');
  await expect(page.getByLabel('Billing', { exact: true })).toContainText('980');
  await assertMobileLayout(page);
  await page.getByRole('combobox', { name: 'Language' }).selectOption('fr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('h1')).toContainText('Votre réputation');
});
