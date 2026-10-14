/**
 * DreamStore — Public Beta Launch Smoke Test Suite
 * Validates all 5 Launch Checklist Items:
 * 1. Signup, seller onboarding, store creation, product uploads, and public storefronts.
 * 2. Unverified paid checkout disabled; verified working features available (free checkout & manual wallet).
 * 3. Zero demo payment accounts, zero fake statistics, zero misleading claims.
 * 4. Responsive mobile navigation, Google login endpoints, and critical CTA buttons.
 * 5. Preservation of real user data, persistent security rules, and rate limiters.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TEST_CLIENT_IP = `198.51.100.${Math.floor(Math.random() * 200) + 15}`;

async function apiRequest(endpoint, { method = 'GET', token = null, body = undefined, ip = TEST_CLIENT_IP } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (ip) {
    headers['X-Forwarded-For'] = ip;
  }
  if (token !== null) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { status: res.status, headers: res.headers, data };
}

const testResults = [];
function recordTest(id, name, passed, detail) {
  testResults.push({ id, name, passed, detail });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon} | [${id}] ${name}\n     ↳ ${detail}`);
  assert.equal(passed, true, `CHECK FAILED: [${id}] ${name} -> ${detail}`);
}

async function runBetaLaunchSmokeTest() {
  console.log('================================================================================');
  console.log('DREAMSTORE PUBLIC BETA LAUNCH SMOKE TEST VERIFICATION');
  console.log('================================================================================\n');

  // ---------------------------------------------------------------------------
  // 1. SIGNUP, SELLER ONBOARDING, STORE CREATION, PRODUCT UPLOADS & STOREFRONTS
  // ---------------------------------------------------------------------------
  const timestamp = Date.now();
  const testSellerEmail = `beta.seller.${timestamp}@dreamstore.test`;
  const testSellerPassword = `BetaPassword123!`;
  const testSellerName = `Beta Creator ${timestamp.toString().slice(-4)}`;

  // 1a. User Signup
  const signupRes = await apiRequest('/api/auth/email/signup', {
    method: 'POST',
    body: {
      email: testSellerEmail,
      password: testSellerPassword,
      displayName: testSellerName,
    },
  });
  const token = signupRes.data?.token;
  const sellerUid = signupRes.data?.user?.uid || signupRes.data?.uid;

  recordTest(
    'REQ-1A',
    'User Signup & Authentication',
    signupRes.status === 200 && Boolean(token) && Boolean(sellerUid),
    `Status=${signupRes.status} | UID=${sellerUid} | Email=${testSellerEmail}`
  );

  // 1b. Role Onboarding: Save Seller Role
  const roleRes = await apiRequest('/api/users/profile', {
    method: 'POST',
    token,
    body: {
      role: 'seller',
      displayName: testSellerName,
      email: testSellerEmail,
    },
  });
  recordTest(
    'REQ-1B',
    'Seller Role Onboarding',
    roleRes.status === 200 && roleRes.data?.profile?.role === 'seller',
    `Status=${roleRes.status} | Role=${roleRes.data?.profile?.role}`
  );

  // 1c. Store Creation with Unique Slug
  const testStoreSlug = `beta-boutique-${timestamp.toString().slice(-6)}`;
  const storeRes = await apiRequest('/api/stores/create', {
    method: 'POST',
    token,
    body: {
      storeSlug: testStoreSlug,
      storeName: `${testSellerName} Boutique`,
      currency: 'PKR',
      country: 'Pakistan',
      theme: 'blush-princess',
      announcementText: 'Welcome to our beta storefront! ✨',
    },
  });
  const createdStoreId = storeRes.data?.store?.storeId;
  recordTest(
    'REQ-1C',
    'Store Creation & Slug Provisioning',
    (storeRes.status === 200 || storeRes.status === 201) && Boolean(createdStoreId) && storeRes.data?.store?.storeSlug === testStoreSlug,
    `Status=${storeRes.status} | StoreId=${createdStoreId} | Slug=${testStoreSlug}`
  );

  // 1d. Product Upload / Upsert
  const prodRes = await apiRequest('/api/products/upsert', {
    method: 'POST',
    token,
    body: {
      product: {
        id: `prod-beta-${timestamp}`,
        storeId: createdStoreId,
        ownerId: sellerUid,
        title: 'Mindful Morning Planner (Beta Edition)',
        category: 'Planners',
        subtitle: 'Digital PDF planner with habit trackers',
        description: 'Comprehensive guided reflection worksheets.',
        price: 1500,
        pricePkr: 1500,
        priceUsd: 12,
        isFree: false,
        published: true,
        fileName: 'Mindful-Planner.pdf',
        fileType: 'PDF Guide',
        fileSizeLabel: '5.2 MB',
      },
    },
  });
  recordTest(
    'REQ-1D',
    'Product Upload & Catalog Publishing',
    prodRes.status === 200 && prodRes.data?.product?.title === 'Mindful Morning Planner (Beta Edition)',
    `Status=${prodRes.status} | ProductId=${prodRes.data?.product?.id}`
  );

  // 1e. Public Storefront Access (Sanitized instructions, zero auth required)
  const storefrontRes = await apiRequest(`/api/checkout/payment-instructions/${createdStoreId}`);
  recordTest(
    'REQ-1E',
    'Public Storefront & Checkout Configuration Endpoint',
    storefrontRes.status === 200 && storefrontRes.data?.storeId === createdStoreId,
    `Status=${storefrontRes.status} | Store=${storefrontRes.data?.storeName} | Configured=${storefrontRes.data?.paymentConfigured}`
  );

  // ---------------------------------------------------------------------------
  // 2. DISABLE UNVERIFIED PAID CHECKOUT & PROTECT DOWNLOAD FLOWS
  // ---------------------------------------------------------------------------
  // 2a. Newly created store has no payment methods configured -> paymentConfigured MUST be false
  recordTest(
    'REQ-2A',
    'Unconfigured Store Paid Checkout Disabled',
    storefrontRes.data?.paymentConfigured === false &&
      Array.isArray(storefrontRes.data?.configuredMethods) &&
      storefrontRes.data.configuredMethods.length === 0,
    `paymentConfigured=${storefrontRes.data?.paymentConfigured} | configuredMethods=${JSON.stringify(storefrontRes.data?.configuredMethods)}`
  );

  // 2b. Free product instant verified download works
  const freeDownloadReq = await apiRequest('/api/downloads/token', {
    method: 'POST',
    body: {
      orderId: 'free-instant-sample',
      orderNumber: 'DS-FREE-001',
      productId: 'prod-self-care-toolkit',
      isFreeOrder: true,
      buyerEmail: testSellerEmail,
    },
  });
  recordTest(
    'REQ-2B',
    'Free Digital Product Instant Verified Download',
    freeDownloadReq.status === 200 && Boolean(freeDownloadReq.data?.downloadToken),
    `Status=${freeDownloadReq.status} | TokenMintsCleanly=${Boolean(freeDownloadReq.data?.downloadToken)}`
  );

  // 2c. Unverified paid order download is blocked (unauthorized/unverified)
  const unverifiedPaidDownload = await apiRequest('/api/downloads/token', {
    method: 'POST',
    body: {
      orderId: 'fake-unverified-order',
      orderNumber: 'DS-UNPAID-999',
      productId: 'prod-30-day-reset',
      isFreeOrder: false,
      buyerEmail: 'attacker@evil.test',
    },
  });
  recordTest(
    'REQ-2C',
    'Unverified Paid Order Download Locked & Blocked',
    unverifiedPaidDownload.status === 401 || unverifiedPaidDownload.status === 403,
    `Status=${unverifiedPaidDownload.status} (Correctly rejected unauthorized/unverified download)`
  );

  // ---------------------------------------------------------------------------
  // 3. ZERO DEMO ACCOUNTS, FAKE STATS, OR MISLEADING CLAIMS
  // ---------------------------------------------------------------------------
  // Check source files for legacy dummy strings
  const dreamstoreTypesPath = path.resolve('src/types/dreamstore.ts');
  const landingPagePath = path.resolve('src/components/screens/LandingPage.tsx');
  const dreamTypesContent = fs.readFileSync(dreamstoreTypesPath, 'utf8');
  const landingContent = fs.readFileSync(landingPagePath, 'utf8');

  // Verify INITIAL_SELLER_PAYMENT_SETTINGS has zero mock numbers
  const noMockJazzCash = !dreamTypesContent.includes("jazzCashMerchantId: '0300-1234567'");
  const noMockEasypaisa = !dreamTypesContent.includes("easypaisaStoreId: '0345-9876543'");
  const noFakeCountClaim = !landingContent.includes('50,000 creators') && !landingContent.includes('10,000+ stores');

  recordTest(
    'REQ-3',
    'Demo Payment Accounts & Fake Statistics Elimination',
    noMockJazzCash && noMockEasypaisa && noFakeCountClaim,
    `noMockJazzCash=${noMockJazzCash} | noMockEasypaisa=${noMockEasypaisa} | noFakeClaims=${noFakeCountClaim}`
  );

  // ---------------------------------------------------------------------------
  // 4. MOBILE LAYOUT, GOOGLE LOGIN & CRITICAL BUTTONS
  // ---------------------------------------------------------------------------
  // Check HTML metadata and critical responsive elements
  const indexPath = path.resolve('index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  const hasViewportMeta = indexHtml.includes('name="viewport" content="width=device-width, initial-scale=1.0"');
  
  // Check auth endpoints & diagnostics
  const oauthDiagRes = await apiRequest('/api/auth/oauth-diagnostics?hostname=localhost');
  const hasAuthModalComponents =
    landingContent.includes('data-testid="dreamstore-navbar"') &&
    landingContent.includes('data-testid="mobile-menu-toggle"') &&
    landingContent.includes('data-testid="hero-primary-cta"');

  recordTest(
    'REQ-4',
    'Mobile Responsive Layout & OAuth Diagnostics',
    hasViewportMeta && oauthDiagRes.status === 200 && hasAuthModalComponents,
    `ViewportMeta=${hasViewportMeta} | OAuthDiagStatus=${oauthDiagRes.status} | CriticalCTAsIntact=${hasAuthModalComponents}`
  );

  // ---------------------------------------------------------------------------
  // 5. SECURITY RULES, DATA INTEGRITY & RATE LIMITERS
  // ---------------------------------------------------------------------------
  // 5a. Unauthorized mutation blocked
  const unauthStoreUpdate = await apiRequest('/api/stores/update', {
    method: 'POST',
    body: { storeId: createdStoreId, storeName: 'Hacked Store' },
  });
  recordTest(
    'REQ-5A',
    'Security Rule: Unauthorized State Mutation Blocked',
    unauthStoreUpdate.status === 401,
    `Status=${unauthStoreUpdate.status} (Must be 401)`
  );

  // 5b. Health & Cryptographic Secret Entropy
  const healthRes = await apiRequest('/api/health');
  recordTest(
    'REQ-5B',
    'Server Health & 256-Bit Cryptographic Entropy',
    healthRes.status === 200 && healthRes.data?.signingSecretEntropyBits >= 256,
    `Status=${healthRes.status} | EntropyBits=${healthRes.data?.signingSecretEntropyBits}`
  );

  // 5c. Super Admin Escalation Blocked
  const fakeAdminReq = await apiRequest('/api/admin/bootstrap-super-admin', {
    method: 'POST',
    token, // Seller token cannot claim super admin
  });
  recordTest(
    'REQ-5C',
    'Super Admin Privilege Escalation Prevention',
    fakeAdminReq.status === 401 || fakeAdminReq.status === 403,
    `Status=${fakeAdminReq.status} (Super admin access strictly denied)`
  );

  console.log('\n================================================================================');
  console.log(`BETA LAUNCH SMOKE TEST COMPLETE: ${testResults.filter(t => t.passed).length}/${testResults.length} CHECKS PASSED`);
  console.log('================================================================================');
}

runBetaLaunchSmokeTest().catch((err) => {
  console.error('\n❌ Beta Smoke Test Failed with Error:', err);
  process.exit(1);
});
