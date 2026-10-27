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
    assert.equal(await cart.getByTestId('submit-checkout-order-btn').isDisabled(), true);
    assert.match(await cart.getByTestId('checkout-cart-requirement').innerText(), /one digital product/);
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
    assert.doesNotMatch(text, /Ananya Creates|mateenfatima5958@gmail\.com|seller-pk-fatima/i);
    assert.equal(await page.getByTestId('navbar-user-email').count(), 0);
  } finally { await page.close(); }
});

test('Production checkout does not offer test-buyer identity or payment instructions while locked', async () => {
  const page = await visit('/?screen=checkout');
  try {
    await page.getByTestId('buyer-cart-section').waitFor({ state: 'visible', timeout: 30000 });
    assert.equal(await page.getByTestId('enable-sandbox-buyer-btn').count(), 0);
    assert.doesNotMatch(await page.locator('body').innerText(), /Amina Test Buyer|Use Sandbox Buyer/i);
  } finally { await page.close(); }
});

test('Rejected restored email session requires sign-in instead of trusting cached seller role', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  try {
    await page.addInitScript(() => {
      const uid = 'u_restored_stale_seller';
      localStorage.setItem('dreamstore_email_auth_session_v1', JSON.stringify({
        token: 'DS_EMAIL_SESSION.invalid.browser-token',
        expiresAtMs: Date.now() + 3600_000,
        user: {
          uid,
          email: 'expired-session@local.test',
          displayName: 'Expired Seller',
          emailVerified: true,
        },
      }));
      localStorage.setItem('dreamstore_user_profile_' + uid, JSON.stringify({
        uid, role: 'seller', displayName: 'Expired Seller',
        email: 'expired-session@local.test', onboardingCompleted: true,
      }));
    });
    await page.route('**/api/admin/verify-session', route =>
      route.fulfill({ status: 403, contentType: 'application/json', body: '{}' })
    );
    await page.route('**/api/users/profile', route =>
      route.fulfill({ status: 401, contentType: 'application/json',
        body: JSON.stringify({ code: 'auth/session-invalid', error: 'Sign in again.' }) })
    );
    await page.goto(origin + '/?screen=landing', { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.getByTestId('hero-headline').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByTestId('candyland-auth-modal').waitFor({ state: 'visible', timeout: 30000 });
    assert.equal(await page.getByTestId('role-nav-seller').count(), 0);
    assert.equal(await page.getByTestId('auth-tab-signin').getAttribute('aria-selected'), 'true');
    const session = await page.evaluate(() => localStorage.getItem('dreamstore_email_auth_session_v1'));
    assert.equal(session, null, 'Rejected legacy session must be erased');
  } finally { await page.close(); }
});

test('Restored account gets actionable retry when hosted frontend cannot reach JSON backend', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  try {
    await page.addInitScript(() => {
      localStorage.setItem('dreamstore_email_auth_session_v1', JSON.stringify({
        token: 'DS_EMAIL_SESSION.preview-only',
        expiresAtMs: Date.now() + 3600000,
        user: { uid: 'preview-session', email: 'preview@local.test',
          displayName: 'Preview Seller', emailVerified: true },
      }));
    });
    await page.route('**/api/admin/verify-session', route =>
      route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }));
    await page.route('**/api/users/profile', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Frontend fallback</html>' }));
    await page.goto(origin + '/?screen=landing', { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.getByTestId('retry-account-verification').waitFor({ state: 'visible', timeout: 30000 });
    await assert.match(await page.locator('body').innerText(), /DreamStore API is not connected/);
    assert.equal(await page.getByTestId('role-nav-seller').count(), 0);
  } finally { await page.close(); }
});


test('Mobile authentication fields keep icons separate from placeholder and password toggle', async () => {
  const page = await visit('/', { width: 375, height: 812 });
  try {
    await page.getByTestId('hero-primary-cta').click();
    await page.getByTestId('candyland-auth-modal').waitFor({ state: 'visible', timeout: 10000 });
    for (const field of ['auth-name-input', 'auth-email-input', 'auth-password-input']) {
      const padding = await page.getByTestId(field).evaluate(el => parseFloat(getComputedStyle(el).paddingLeft));
      assert.ok(padding >= 40, `${field} must reserve at least 40px for its leading icon; got ${padding}`);
    }
    const trailing = await page.getByTestId('auth-password-input').evaluate(el => parseFloat(getComputedStyle(el).paddingRight));
    assert.ok(trailing >= 40, `Password must reserve space for visibility toggle; got ${trailing}`);
  } finally { await page.close(); }
});
