import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.APP_URL || 'http://127.0.0.1:3000';
let browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });

async function visit(path, viewport = { width: 1280, height: 820 }) {
  const page = await browser.newPage({ viewport });
  await page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout: 40000 });
  return page;
}

test('Guest sees a clear landing and can enter signup, never a private dashboard', async () => {
  const page = await visit('/');
  try {
    await page.getByTestId('hero-headline').waitFor({ state: 'visible', timeout: 30000 });
    assert.equal(await page.getByTestId('navbar-user-email').count(), 0);
    await page.getByTestId('hero-primary-cta').click();
    await page.getByTestId('candyland-auth-modal').waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await page.getByTestId('auth-tab-signup').getAttribute('aria-selected'), 'true');
  } finally { await page.close(); }
});

test('Explore Stores shows real directory/empty state, not theme mockup as stores', async () => {
  const page = await visit('/');
  try {
    await page.getByTestId('hero-secondary-cta').click();
    await page.getByTestId('live-store-directory').waitFor({ state: 'visible' });
    const directory = await page.getByTestId('live-store-directory').innerText();
    assert.ok(directory.includes('No public creator stores') || directory.includes('Visit'));
  } finally { await page.close(); }
});

test('Guest private deep links display landing, not seller/admin content', async () => {
  for (const screen of ['wizard', 'owner-dashboard', 'visual-editor', 'super-admin']) {
    const page = await visit('/?screen=' + screen);
    try {
      await page.getByTestId('hero-headline').waitFor({ state: 'visible', timeout: 30000 });
      assert.equal(await page.getByTestId('role-nav-seller').count(), 0);
      assert.equal(await page.getByTestId('role-nav-buyer').count(), 0);
    } finally { await page.close(); }
  }
});

test('Invalid store link cannot show a fabricated storefront', async () => {
  const page = await visit('/?store=does-not-exist-2026-zz');
  try {
    await page.getByTestId('hero-headline').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByTestId('role-access-blocked-banner').waitFor({ state: 'visible', timeout: 30000 });
    assert.match(await page.getByTestId('role-access-blocked-banner').innerText(), /Store not found/);
  } finally { await page.close(); }
});

test('Cart starts empty for guests; mobile landing CTA stays usable', async () => {
  const cart = await visit('/?screen=checkout');
  try {
    await cart.getByTestId('buyer-cart-section').waitFor({ state: 'visible', timeout: 30000 });
    const text = await cart.getByTestId('buyer-cart-section').innerText();
    assert.match(text, /empty|no items|bag/i);
    assert.doesNotMatch(text, /30.Day Reset|Mindful Journal/i);
  } finally { await cart.close(); }
  const mobile = await visit('/', { width: 375, height: 812 });
  try {
    await mobile.getByTestId('hero-primary-cta').waitFor({ state: 'visible', timeout: 30000 });
    await mobile.getByTestId('hero-primary-cta').click();
    await mobile.getByTestId('candyland-auth-modal').waitFor({ state: 'visible', timeout: 10000 });
    const overflow = await mobile.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    assert.ok(overflow <= 2, 'Mobile viewport has horizontal overflow: ' + overflow);
  } finally { await mobile.close(); }
});

test('Production visitor never sees seeded seller identities or account email', async () => {
  const page = await visit('/');
  try {
    await page.getByTestId('hero-headline').waitFor({ state: 'visible', timeout: 30000 });
    const text = await page.locator('body').innerText();
    assert.doesNotMatch(text, /Fatima\.tech|Ananya Creates|mateenfatima5958@gmail\.com|seller-pk-fatima/i);
    assert.equal(await page.getByTestId('navbar-user-email').count(), 0);
  } finally { await page.close(); }
});
