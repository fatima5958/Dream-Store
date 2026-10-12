/**
 * DreamStore — Real Browser Playwright Regression Test Suite
 * Tests the Store Setup Wizard end-to-end against http://localhost:3000
 */

import { chromium } from 'playwright';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

async function runPlaywrightWizardTests() {
  const results = [];
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  const record = (id, name, passed, evidence) => {
    results.push({ id, name, passed, evidence });
    const icon = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${icon} | ${id}: ${name}\n   ↳ ${evidence}`);
  };

  const uniqueId = Date.now().toString().slice(-5);
  const takenSlug = `taken-store-${uniqueId}`;
  const customStoreName = `Ayla Digital Studio ${uniqueId}`;
  const updatedStoreName = `Ayla Luxe Studio ${uniqueId}`;
  const customSlug = `ayla.luxe.${uniqueId}`;
  const customInstagram = `@ayla.luxe.${uniqueId}`;

  // Pre-seed a store Owned by another seller so we can test duplicate slug rejection in the browser
  await fetch(`${BASE_URL}/api/stores/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storeId: `store-other-seller-${uniqueId}`,
      ownerId: `other-seller-${uniqueId}`,
      ownerEmail: `other.${uniqueId}@dreamstore.test`,
      storeSlug: takenSlug,
      storeName: 'Existing Creator Store',
      country: 'Pakistan',
      currency: 'PKR',
      theme: 'blush-rose',
    }),
  });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });
  page.on('requestfailed', (req) => {
    const url = req.url();
    // Ignore external analytics/fonts if any
    if (url.startsWith(BASE_URL)) {
      failedRequests.push(`${req.method()} ${url} -> ${req.failure()?.errorText}`);
    }
  });

  try {
    // 1. Open Store Setup Wizard (use domcontentloaded since Firestore WebChannel keeps connections open)
    await page.goto(`${BASE_URL}/?screen=wizard`, { waitUntil: 'domcontentloaded' });
    await page.locator('h2').first().waitFor({ state: 'visible', timeout: 15000 });

    const step1Heading = await page.locator('h2').first().textContent();
    record(
      'PW-1',
      'Open Store Setup Wizard Step 1 & Continue to Step 2',
      Boolean(step1Heading && step1Heading.includes('What would you like to do today')),
      `Step 1 Heading="${step1Heading?.trim()}"`
    );

    await page.getByTestId('wizard-continue-button').click();
    await page.getByTestId('wizard-store-name-input').waitFor({ state: 'visible' });

    // 2. Enter completely new Store Name; verify auto-derived slug works and clearing does NOT reset to fatima.tech
    const nameInput = page.getByTestId('wizard-store-name-input');
    const slugInput = page.getByTestId('wizard-store-slug-input');
    const igInput = page.getByTestId('wizard-instagram-input');

    await nameInput.fill('');
    await slugInput.fill('');
    const emptySlugVal = await slugInput.inputValue();

    await nameInput.fill(customStoreName);
    const autoDerivedSlug = await slugInput.inputValue();

    record(
      'PW-2',
      'Controlled Form Inputs: Clearing Does Not Reset to Demo "fatima.tech" & Auto-Derives Initial Slug',
      emptySlugVal === '' &&
        autoDerivedSlug === `ayla-digital-studio-${uniqueId}` &&
        autoDerivedSlug !== 'fatima.tech',
      `ClearedSlug="${emptySlugVal}", AutoDerivedSlug="${autoDerivedSlug}"`
    );

    // 3. Manually edit Custom Slug and Instagram Handle, then change Store Name again
    await slugInput.fill(customSlug);
    await igInput.fill(customInstagram);

    // Now change Store Display Name and confirm manually edited slug is NOT overwritten!
    await nameInput.fill(updatedStoreName);
    const slugAfterNameChange = await slugInput.inputValue();
    const nameAfterEdit = await nameInput.inputValue();
    const igAfterEdit = await igInput.inputValue();

    record(
      'PW-3',
      'Changing Store Name Does Not Overwrite Manually Edited Custom Slug or Instagram Handle',
      nameAfterEdit === updatedStoreName &&
        slugAfterNameChange === customSlug &&
        igAfterEdit === customInstagram,
      `StoreName="${nameAfterEdit}", PreservedManualSlug="${slugAfterNameChange}", Instagram="${igAfterEdit}"`
    );

    // 4. Validate Reserved Slug & Taken Slug Uniqueness Check with Helpful Error Messages
    await slugInput.fill(takenSlug);
    await page.waitForTimeout(450);
    await page.getByTestId('wizard-continue-button').click();

    const step2ErrorVisible = await page.locator('text=already').first().isVisible();
    const stillOnStep2 = await nameInput.isVisible();

    record(
      'PW-4',
      'Duplicate Store Slug Blocked with Helpful Error Message (Does Not Silently Fail)',
      step2ErrorVisible && stillOnStep2,
      `TakenSlug="${takenSlug}", HelpfulErrorVisible=${step2ErrorVisible}, BlockedAdvance=${stillOnStep2}`
    );

    // 5. Restore Unique Custom Slug, Verify Availability & Navigate Forward/Back Across All 10 Steps
    await slugInput.fill(customSlug);
    await page.waitForTimeout(450);
    const slugStatusText = await page.getByTestId('wizard-slug-status').textContent();

    // Advance Step 2 -> Step 3
    await page.getByTestId('wizard-continue-button').click();
    await page.locator('h2:has-text("3. What kind of digital products")').waitFor({ state: 'visible' });

    // Click Previous Step (Step 3 -> Step 2) and confirm inputs are preserved
    await page.getByTestId('wizard-prev-button').click();
    await nameInput.waitFor({ state: 'visible' });
    const persistedNameOnBack = await nameInput.inputValue();
    const persistedSlugOnBack = await slugInput.inputValue();
    const persistedIgOnBack = await igInput.inputValue();

    record(
      'PW-5',
      'Step 2 Availability Check + Continue & Back Navigation Preserves User Inputs',
      Boolean(slugStatusText && slugStatusText.includes('available')) &&
        persistedNameOnBack === updatedStoreName &&
        persistedSlugOnBack === customSlug &&
        persistedIgOnBack === customInstagram,
      `Availability="${slugStatusText?.trim()}", BackVerifyName="${persistedNameOnBack}", BackVerifySlug="${persistedSlugOnBack}", BackVerifyIG="${persistedIgOnBack}"`
    );

    // Traverse Steps 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10
    for (let step = 2; step <= 9; step++) {
      await page.getByTestId('wizard-continue-button').click();
      await page.waitForTimeout(120);
    }

    const step10Heading = await page.locator('h2').textContent();
    record(
      'PW-6',
      'Wizard Traverses All 10 Steps Smoothly to Final Launch Screen',
      Boolean(step10Heading && step10Heading.includes('10. Your DreamStore is Ready to Launch')),
      `Step 10 Heading="${step10Heading?.trim()}"`
    );

    // 6. Click "Launch My Store" on Step 10 -> Verify Store Created & Loaded in Owner Dashboard
    await page.getByTestId('wizard-continue-button').click();
    await page.waitForURL((url) => url.searchParams.get('screen') === 'owner-dashboard', {
      timeout: 5000,
    });

    const dashboardBodyBeforeReload = await page.locator('body').textContent();
    const hasStoreNameInDashboard = Boolean(
      dashboardBodyBeforeReload && dashboardBodyBeforeReload.includes(updatedStoreName)
    );

    // 7. Refresh the page and verify store data persists after refresh
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    const dashboardBodyAfterReload = await page.locator('body').textContent();
    const persistsAfterRefresh = Boolean(
      dashboardBodyAfterReload && dashboardBodyAfterReload.includes(updatedStoreName)
    );

    record(
      'PW-7',
      'Completed Wizard Creates Store Document & Persists After Full Browser Refresh',
      hasStoreNameInDashboard && persistsAfterRefresh,
      `BeforeRefreshHasStoreName=${hasStoreNameInDashboard}, AfterRefreshHasStoreName=${persistsAfterRefresh}, URL="${page.url()}"`
    );

    // 8. Open Public Store URL (/?store=<customSlug>) in a Brand-New Browser Context and Verify Public Storefront
    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();
    await publicPage.goto(`${BASE_URL}/?store=${encodeURIComponent(customSlug)}`, {
      waitUntil: 'domcontentloaded',
    });
    await publicPage.waitForTimeout(700);
    const publicBodyText = await publicPage.locator('body').textContent();
    const publicLoadsCorrectStore = Boolean(
      publicBodyText && publicBodyText.includes(updatedStoreName)
    );

    record(
      'PW-8',
      'Public Store URL (/?store=<slug>) Loads Correct Store in Fresh Browser Session',
      publicLoadsCorrectStore,
      `PublicURL="${BASE_URL}/?store=${customSlug}", LoadedStoreName="${updatedStoreName}", Found=${publicLoadsCorrectStore}`
    );

    await publicContext.close();

    // 9. Verify Zero Console Errors, Page Crashes, or Failed API Requests
    record(
      'PW-9',
      'Zero Browser Console Errors, Uncaught Page Exceptions, or Failed Local API Requests',
      consoleErrors.length === 0 && pageErrors.length === 0 && failedRequests.length === 0,
      `ConsoleErrors=${consoleErrors.length}, PageErrors=${pageErrors.length}, FailedRequests=${failedRequests.length}`
    );
  } finally {
    await browser.close();
  }

  const passedCount = results.filter((r) => r.passed).length;
  console.log(`\n======================================================`);
  console.log(`PLAYWRIGHT REAL BROWSER RESULTS: ${passedCount}/${results.length} PASSED`);
  console.log(`======================================================`);

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

runPlaywrightWizardTests().catch((err) => {
  console.error('Playwright test error:', err);
  process.exit(1);
});
