import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const VIEWPORTS = [320, 360, 375, 390, 430, 768, 1024, 1440];

async function run() {
  console.log('=== DreamStore UX Simplification & Mobile Typography Verification ===');
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on('pageerror', (err) => console.error('[PAGE ERROR]', err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('WebSocket')) {
        console.error('[CONSOLE ERROR]', msg.text());
      }
    });

    // 1. Multi-Viewport Horizontal Overflow & Typography Audit on Landing Page
    console.log('\n--- Step 1: 8-Viewport Overflow & Mobile Typography Audit ---');
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('[data-testid="landing-hero-heading"]').waitFor({ timeout: 25000 });

    for (const width of VIEWPORTS) {
      const height = width < 768 ? 800 : 900;
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(150);

      const metrics = await page.evaluate(() => {
        const docWidth = document.documentElement.scrollWidth;
        const clientWidth = document.documentElement.clientWidth;
        const heroHeading = document.querySelector('[data-testid="landing-hero-heading"]');
        const heroFontSize = heroHeading ? window.getComputedStyle(heroHeading).fontSize : null;
        const primaryCta = document.querySelector('[data-testid="landing-primary-cta"]');
        const ctaRect = primaryCta ? primaryCta.getBoundingClientRect() : null;
        return {
          docWidth,
          clientWidth,
          hasHorizontalOverflow: docWidth > clientWidth + 1,
          heroFontSize,
          ctaHeight: ctaRect ? Math.round(ctaRect.height) : 0,
        };
      });

      console.log(
        `Viewport ${width}x${height}: scrollWidth=${metrics.docWidth}, clientWidth=${metrics.clientWidth}, heroFontSize=${metrics.heroFontSize}, ctaHeight=${metrics.ctaHeight}px`
      );

      if (metrics.hasHorizontalOverflow) {
        throw new Error(`Horizontal overflow detected at ${width}px: scrollWidth=${metrics.docWidth} > clientWidth=${metrics.clientWidth}`);
      }
      if (metrics.ctaHeight < 44) {
        throw new Error(`Primary CTA touch target below 44px at ${width}px: ${metrics.ctaHeight}px`);
      }
    }

    // 2. Verify Simplified Landing Page 6-Section Structure & 5-Second Value Proposition
    console.log('\n--- Step 2: Landing Page 5-Second Clarity & 6-Section Structure ---');
    await page.setViewportSize({ width: 375, height: 812 });

    const heroHeadline = await page.locator('[data-testid="landing-hero-heading"]').textContent();
    const heroSubheading = await page.locator('[data-testid="landing-hero-subheading"]').textContent();
    const primaryCtaText = await page.locator('[data-testid="landing-primary-cta"]').textContent();
    const secondaryCtaText = await page.locator('[data-testid="landing-secondary-cta"]').textContent();

    console.log('Hero Headline:', heroHeadline?.trim());
    console.log('Supporting Copy:', heroSubheading?.trim());
    console.log('Primary CTA:', primaryCtaText?.trim());
    console.log('Secondary Link:', secondaryCtaText?.trim());

    if (!heroHeadline?.includes('Your Dream Store') || !heroHeadline?.includes('Starts Here.')) {
      throw new Error(`Unexpected hero headline: ${heroHeadline}`);
    }
    if (!heroSubheading?.includes('Create your free digital store, add your products, and share your link.')) {
      throw new Error(`Unexpected supporting copy: ${heroSubheading}`);
    }
    if (!primaryCtaText?.includes('Create My Free Store')) {
      throw new Error(`Unexpected primary CTA: ${primaryCtaText}`);
    }
    if (!secondaryCtaText?.includes('Explore Stores')) {
      throw new Error(`Unexpected secondary link: ${secondaryCtaText}`);
    }

    const sectionTestIds = [
      'landing-hero-section',
      'landing-preview-section',
      'landing-how-it-works-section',
      'landing-benefits-section',
      'landing-faq-section',
      'landing-footer-section',
    ];
    for (const id of sectionTestIds) {
      const visible = await page.locator(`[data-testid="${id}"]`).isVisible();
      if (!visible) throw new Error(`Landing page section missing or hidden: ${id}`);
    }
    console.log('Verified all 6 clean landing page sections are present.');

    // 3. Verify First-Time User Walkthrough: Store Creation Wizard & Mobile Input Font Size
    console.log('\n--- Step 3: Store Creation Wizard & Mobile Input Font Size Check ---');
    await page.locator('[data-testid="landing-primary-cta"]').click();
    await page.getByRole('heading', { name: /What would you like to do today/i }).waitFor({ timeout: 15000 });

    const progressBarVisible = await page.locator('[data-testid="wizard-progress-bar"]').isVisible();
    if (!progressBarVisible) throw new Error('Wizard progress bar is not visible');

    // Move to Step 2 and check input font size >= 16px on mobile (375px)
    await page.getByRole('button', { name: /Continue/i }).click();
    const storeNameInput = page.getByTestId('wizard-store-name-input');
    await storeNameInput.waitFor({ timeout: 10000 });

    const inputFontSizePx = await storeNameInput.evaluate((el) => {
      return parseFloat(window.getComputedStyle(el).fontSize);
    });
    console.log(`Mobile (375px) input font-size: ${inputFontSizePx}px (must be >= 16px to prevent iOS zoom)`);
    if (inputFontSizePx < 16) {
      throw new Error(`Mobile input font size is ${inputFontSizePx}px (< 16px)`);
    }

    // 4. Verify Seller Dashboard Simplification & Clean Add Product Experience
    console.log('\n--- Step 4: Seller Dashboard 5-Item Navigation & Clean Product Upload ---');
    await page.getByRole('button', { name: /Home/i }).first().click();
    await page.locator('[data-testid="landing-footer-section"]').getByRole('button', { name: 'Seller Dashboard' }).click();

    await page.locator('[data-testid="dashboard-overview-tab"]').waitFor({ timeout: 15000 });

    // Verify 5 Seller Dashboard navigation tabs exist
    const expectedTabs = [
      'dashboard-nav-overview',
      'dashboard-nav-products',
      'dashboard-nav-orders',
      'dashboard-nav-store-design',
      'dashboard-nav-settings',
    ];
    for (const tabId of expectedTabs) {
      const visible = await page.locator(`[data-testid="${tabId}"]`).isVisible();
      if (!visible) throw new Error(`Seller dashboard navigation tab missing: ${tabId}`);
    }
    console.log('Verified 5-item Seller Dashboard navigation: Overview, Products, Orders, Store Design, Settings.');

    // Verify Overview primary ("Add Product") & secondary ("View My Store") actions and setup checklist
    const addProductVisible = await page.locator('[data-testid="overview-add-product-btn"]').isVisible();
    const viewStoreVisible = await page.locator('[data-testid="overview-view-store-btn"]').isVisible();
    const checklistVisible = await page.locator('[data-testid="seller-setup-checklist"]').isVisible();
    if (!addProductVisible || !viewStoreVisible || !checklistVisible) {
      throw new Error('Overview primary/secondary actions or setup checklist missing');
    }
    console.log('Verified Overview answers 4 core questions with Add Product, View My Store, and Setup Checklist.');

    // Check mobile overflow on Seller Dashboard at 320px
    await page.setViewportSize({ width: 320, height: 800 });
    await page.waitForTimeout(150);
    const dashOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    });
    if (dashOverflow) {
      throw new Error('Horizontal overflow detected on Seller Dashboard at 320px');
    }
    console.log('Verified Seller Dashboard has zero horizontal overflow at 320px.');

    // Open Add Product Modal and verify essential fields + collapsible Advanced Settings
    await page.locator('[data-testid="overview-add-product-btn"]').click();
    await page.locator('[data-testid="product-title-input"]').waitFor({ timeout: 10000 });
    const publishBtnText = await page.locator('[data-testid="publish-product-btn"]').textContent();
    console.log('Product Upload Primary Action:', publishBtnText?.trim());

    // Toggle collapsible Advanced Settings
    await page.locator('[data-testid="toggle-advanced-product-settings"]').click();
    await page.getByText(/Product Category/i).waitFor({ timeout: 5000 });
    console.log('Verified Clean Product Upload modal with collapsible Advanced Settings.');

    // Close modal
    await page.getByRole('button', { name: 'Cancel' }).click();

    // 5. Verify 6 Signature Storefront Themes, Live Preview, Accent Color & Published Storefront Update
    console.log('\n--- Step 5: 6 Storefront Themes & Live Storefront Rendering ---');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('[data-testid="dashboard-nav-store-design"]').click();
    await page.locator('[data-testid="store-themes-grid"]').waitFor({ timeout: 10000 });

    const sixThemes = [
      'blush-bloom',
      'lavender-cloud',
      'vanilla-studio',
      'midnight-muse',
      'peach-petal',
      'clean-canvas',
    ];
    for (const themeId of sixThemes) {
      const cardVisible = await page.locator(`[data-testid="theme-card-${themeId}"]`).isVisible();
      if (!cardVisible) {
        throw new Error(`Missing storefront theme card: ${themeId}`);
      }
    }
    console.log('Verified all 6 storefront themes exist: Blush Bloom, Lavender Cloud, Vanilla Studio, Midnight Muse, Peach Petal, Clean Canvas.');

    // Preview Vanilla Studio first
    await page.locator('[data-testid="preview-theme-btn-vanilla-studio"]').click();
    const previewAttr = await page.locator('[data-testid="dashboard-theme-preview"]').getAttribute('data-preview-theme');
    if (previewAttr !== 'vanilla-studio') {
      throw new Error(`Expected dashboard preview theme to be vanilla-studio, got ${previewAttr}`);
    }

    // Apply Midnight Muse theme & customize accent color
    await page.locator('[data-testid="apply-theme-btn-midnight-muse"]').click();
    await page.locator('[data-testid="accent-swatch-#8B5CF6"]').click();
    await page.locator('[data-testid="publish-design-changes-btn"]').click();

    // Navigate to live published storefront and verify theme is applied
    await page.getByRole('button', { name: 'Open Live Storefront' }).click();
    await page.locator('[data-testid="storefront-home-root"]').waitFor({ timeout: 10000 });
    const liveStorefrontTheme = await page.locator('[data-testid="storefront-home-root"]').getAttribute('data-theme');
    if (liveStorefrontTheme !== 'midnight-muse') {
      throw new Error(`Expected live storefront theme to be midnight-muse, got ${liveStorefrontTheme}`);
    }
    console.log('Verified live published StorefrontHome dynamically renders with applied Midnight Muse theme.');

    // Verify Shop Page also uses the applied theme
    await page.getByRole('button', { name: /Shop \(/i }).first().click();
    await page.locator('[data-testid="shop-page-root"]').waitFor({ timeout: 10000 });
    const liveShopTheme = await page.locator('[data-testid="shop-page-root"]').getAttribute('data-theme');
    if (liveShopTheme !== 'midnight-muse') {
      throw new Error(`Expected ShopPage theme to be midnight-muse, got ${liveShopTheme}`);
    }
    console.log('Verified ShopPage dynamically renders with applied Midnight Muse theme.');

    await context.close();
    console.log('\n=== ALL UX SIMPLIFICATION, 6 STOREFRONT THEMES & MOBILE TYPOGRAPHY CHECKS PASSED ===');
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
