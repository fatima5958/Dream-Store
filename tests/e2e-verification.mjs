/**
 * DreamStore — Complete End-to-End Automated Functional, Security, Ledger & API Test Suite
 * Executes Phase E (TEST 1 through TEST 12), Phase F (Firebase & Backend Security),
 * and Phase G (Manual Payments & 5% Commission Integrity) against live server & Firestore rules.
 */

import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:3000';

async function postJson(endpoint, body) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, headers: res.headers, data };
}

async function getJson(endpoint) {
  const res = await fetch(`${BASE_URL}${endpoint}`);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, headers: res.headers, data };
}

async function runCompleteAuditSuite() {
  const results = [];
  const record = (id, name, passed, evidence) => {
    results.push({ id, name, passed, evidence });
    console.log(`${passed ? '✅ PASS' : '❌ FAIL'} | ${id}: ${name}\n   ↳ ${evidence}`);
  };

  // TEST 0: Health, Cryptographic Secret Entropy, Security Headers & Rate Limiting
  const health = await getJson('/api/health');
  const hasNosniff = health.headers.get('x-content-type-options') === 'nosniff';
  const hasRateLimitHeaders = Boolean(health.headers.get('x-ratelimit-limit'));
  const dotfileBlocked = await fetch(`${BASE_URL}/.server-signing-secret.key`);
  record(
    'PHASE-F-SEC',
    'Server Health, 256-Bit Non-Predictable Signing Secret, Security Headers & Rate Limiter',
    health.status === 200 &&
      health.data.signingSecretEntropyBits >= 256 &&
      hasNosniff &&
      hasRateLimitHeaders &&
      dotfileBlocked.status === 403,
    `Status=${health.status}, Entropy=${health.data.signingSecretEntropyBits} bits, X-Content-Type-Options=${health.headers.get('x-content-type-options')}, X-RateLimit-Limit=${health.headers.get('x-ratelimit-limit')}, DotfileAccess=${dotfileBlocked.status}`
  );

  // TEST 1: Seller Onboarding & Independent Multi-Vendor Store Creation (PK Seller & IN Seller)
  const uniqueSuffix = Date.now().toString().slice(-5);
  const pkStoreRes = await postJson('/api/stores/create', {
    ownerId: `seller-pk-test-${uniqueSuffix}`,
    ownerEmail: `pk.${uniqueSuffix}@dreamstore.test`,
    storeSlug: `zara-pk-${uniqueSuffix}`,
    storeName: 'Zara Digital Studio PK',
    country: 'Pakistan',
    currency: 'PKR',
    theme: 'blush-rose',
    instagramHandle: '@zaradigital.pk',
  });
  const inStoreRes = await postJson('/api/stores/create', {
    ownerId: `seller-in-test-${uniqueSuffix}`,
    ownerEmail: `in.${uniqueSuffix}@dreamstore.test`,
    storeSlug: `priya-in-${uniqueSuffix}`,
    storeName: 'Priya Notes India',
    country: 'India',
    currency: 'INR',
    theme: 'rosewood',
    instagramHandle: '@priyanotes.in',
  });
  // Verify duplicate slug rejection
  const dupSlugRes = await postJson('/api/stores/create', {
    ownerId: `seller-dup-${uniqueSuffix}`,
    ownerEmail: `dup.${uniqueSuffix}@dreamstore.test`,
    storeSlug: `zara-pk-${uniqueSuffix}`,
    storeName: 'Duplicate Slug Attempt',
    country: 'Pakistan',
    currency: 'PKR',
  });
  record(
    'TEST-1',
    'Seller Onboarding → Unique Store Creation (Pakistan PKR & India INR) & Duplicate Slug Prevention',
    pkStoreRes.status === 201 &&
      inStoreRes.status === 201 &&
      dupSlugRes.status === 409 &&
      pkStoreRes.data.store.currency === 'PKR' &&
      inStoreRes.data.store.currency === 'INR',
    `PK Store=${pkStoreRes.data.store?.storeSlug} (PKR, 201) | IN Store=${inStoreRes.data.store?.storeSlug} (INR, 201) | Duplicate Slug Status=${dupSlugRes.status}`
  );

  // TEST 2: Seller Upload Product (Free PDF & Paid PDF) → Publish → Public Storefront Verification
  const pkStoreId = pkStoreRes.data.store.storeId;
  const pkOwnerId = pkStoreRes.data.store.ownerId;
  const freeProdRes = await postJson('/api/products/save', {
    callerUid: pkOwnerId,
    product: {
      id: `prod-free-pk-${uniqueSuffix}`,
      storeId: pkStoreId,
      ownerId: pkOwnerId,
      title: 'Free Ramadan Gratitude Journal PDF',
      category: 'Workbooks',
      isFree: true,
      priceUsd: 0,
      pricePkr: 0,
      published: true,
      fileName: 'Free-Gratitude-Journal.pdf',
      fileType: 'PDF Workbook',
    },
  });
  const paidProdRes = await postJson('/api/products/save', {
    callerUid: pkOwnerId,
    product: {
      id: `prod-paid-pk-${uniqueSuffix}`,
      storeId: pkStoreId,
      ownerId: pkOwnerId,
      title: 'Complete Freelance Designer Blueprint (Paid PDF)',
      category: 'Ebooks & Guides',
      isFree: false,
      priceUsd: 10,
      pricePkr: 1000,
      published: true,
      fileName: 'Freelance-Blueprint-Paid.pdf',
      fileType: 'PDF Guide',
    },
  });
  const publicStoreCheck = await getJson(`/api/stores/${pkStoreRes.data.store.storeSlug}`);
  record(
    'TEST-2',
    'Seller Product Upload (Free PDF & Paid PDF) → Save → Publish → Public Storefront Catalog',
    freeProdRes.status === 200 &&
      paidProdRes.status === 200 &&
      publicStoreCheck.status === 200 &&
      publicStoreCheck.data.products.length === 2,
    `Free Product=${freeProdRes.data.product?.id} (Rs 0) | Paid Product=${paidProdRes.data.product?.id} (Rs 1,000) | Public Storefront Products Count=${publicStoreCheck.data.products?.length}`
  );

  // TEST 3: Seller Branding & 6-Theme Customization Persistence
  const rulesText = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8');
  const hasStoreThemeRule =
    rulesText.includes('blush-bloom') &&
    rulesText.includes('lavender-cloud') &&
    rulesText.includes('vanilla-studio') &&
    rulesText.includes('midnight-muse') &&
    rulesText.includes('peach-petal') &&
    rulesText.includes('clean-canvas') &&
    (rulesText.includes("data.currency in ['USD', 'PKR', 'INR', 'GBP', 'EUR', 'AED', 'SAR', 'CAD', 'AUD']") ||
      rulesText.includes("data.currency in ['PKR', 'INR', 'USD', 'GBP', 'EUR', 'AED', 'SAR', 'CAD', 'AUD']") ||
      rulesText.includes("incoming().currency in ['PKR', 'INR', 'USD', 'GBP', 'EUR', 'AED', 'SAR', 'CAD', 'AUD']"));
  record(
    'TEST-3',
    'Seller Branding, 6 Storefront Themes & 9-Currency Persistence Validation',
    hasStoreThemeRule && publicStoreCheck.data.store.theme === 'blush-rose',
    `Firestore rules enforce 6 themes & 9 currencies; Store theme="${publicStoreCheck.data.store.theme}", currency="${publicStoreCheck.data.store.currency}"`
  );

  // TEST 4: Buyer Selects Free Product → Instant Verified Order → Download Token Unlocks Immediately
  const freeOrderRes = await postJson('/api/checkout/validate-and-prepare', {
    idempotencyKey: `idem-free-${uniqueSuffix}`,
    buyerId: `buyer-free-${uniqueSuffix}`,
    sellerId: pkOwnerId,
    storeId: pkStoreId,
    customerEmail: 'buyer.free@dreamstore.test',
    currency: 'PKR',
    paymentMethod: 'free_instant',
    paymentReference: 'FREE-INSTANT-VERIFIED',
    items: [
      {
        id: `prod-free-pk-${uniqueSuffix}`,
        title: 'Free Ramadan Gratitude Journal PDF',
        isFree: true,
        priceUsd: 0,
        pricePkr: 0,
        quantity: 1,
      },
    ],
  });
  const freeDownloadVerify = await postJson('/api/delivery/verify-download', {
    orderNumber: freeOrderRes.data.orderNumber,
    productId: `prod-free-pk-${uniqueSuffix}`,
    buyerId: `buyer-free-${uniqueSuffix}`,
    paymentStatus: freeOrderRes.data.initialPaymentStatus,
    downloadToken: freeOrderRes.data.downloadToken,
    downloadCount: 0,
    maxDownloads: 5,
    expiresAtMs: freeOrderRes.data.expiresAtMs,
  });
  record(
    'TEST-4',
    'Buyer Free Product Checkout → Instant Paid Status → Immediate Verified Download Access',
    freeOrderRes.status === 200 &&
      freeOrderRes.data.initialPaymentStatus === 'Paid' &&
      freeDownloadVerify.status === 200 &&
      freeDownloadVerify.data.allowed === true,
    `Order=${freeOrderRes.data.orderNumber}, InitialStatus=${freeOrderRes.data.initialPaymentStatus}, DownloadAllowed=${freeDownloadVerify.data.allowed} (${freeDownloadVerify.data.downloadCount}/5)`
  );

  // TEST 5: Buyer Selects Paid Product (1,000 PKR) → Submits Manual JazzCash Ref → Order Stays Pending & Locked
  const paidOrderRes = await postJson('/api/checkout/validate-and-prepare', {
    idempotencyKey: `idem-paid-${uniqueSuffix}`,
    buyerId: `buyer-paid-${uniqueSuffix}`,
    sellerId: pkOwnerId,
    storeId: pkStoreId,
    customerEmail: 'buyer.paid@dreamstore.test',
    currency: 'PKR',
    paymentMethod: 'jazzcash',
    paymentReference: `JC-TID-${uniqueSuffix}`,
    items: [
      {
        id: `prod-paid-pk-${uniqueSuffix}`,
        title: 'Complete Freelance Designer Blueprint (Paid PDF)',
        isFree: false,
        priceUsd: 10,
        pricePkr: 1000,
        quantity: 1,
      },
    ],
  });
  // Attempt to download BEFORE seller confirms statement (Even if client spoofs paymentStatus: 'Paid'!)
  const prematureDownloadAttempt = await postJson('/api/delivery/verify-download', {
    orderNumber: paidOrderRes.data.orderNumber,
    productId: `prod-paid-pk-${uniqueSuffix}`,
    buyerId: `buyer-paid-${uniqueSuffix}`,
    paymentStatus: 'Paid', // Client spoofing attempt!
    downloadToken: paidOrderRes.data.downloadToken,
    downloadCount: 0,
    maxDownloads: 5,
    expiresAtMs: paidOrderRes.data.expiresAtMs,
  });
  record(
    'TEST-5',
    'Buyer Paid Order (1,000 PKR via JazzCash) → Remains Pending & Blocks Premature/Spoofed Download',
    paidOrderRes.status === 200 &&
      paidOrderRes.data.initialPaymentStatus === 'Pending' &&
      paidOrderRes.data.commissionBreakdown.platformCommissionMinor === 5000 &&
      paidOrderRes.data.commissionBreakdown.sellerShareBeforeFeesMinor === 95000 &&
      prematureDownloadAttempt.status === 403 &&
      prematureDownloadAttempt.data.allowed === false,
    `Order=${paidOrderRes.data.orderNumber}, Status=${paidOrderRes.data.initialPaymentStatus}, 5% Fee=50 PKR (5000 paisa), Seller Share=950 PKR (95000 paisa), PrematureDownloadStatus=${prematureDownloadAttempt.status}`
  );

  // TEST 6: Seller Reviews Payment Against Statement → Confirms in Test Env → Buyer Receives Authorized Download
  const sellerVerifyRes = await postJson('/api/orders/verify-payment', {
    orderNumber: paidOrderRes.data.orderNumber,
    callerUid: pkOwnerId,
    callerRole: 'seller',
    newStatus: 'Paid',
    statementConfirmed: true,
  });
  const authorizedDownloadAttempt = await postJson('/api/delivery/verify-download', {
    orderNumber: paidOrderRes.data.orderNumber,
    productId: `prod-paid-pk-${uniqueSuffix}`,
    buyerId: `buyer-paid-${uniqueSuffix}`,
    paymentStatus: 'Paid',
    downloadToken: sellerVerifyRes.data.downloadToken,
    downloadCount: 0,
    maxDownloads: 5,
    expiresAtMs: paidOrderRes.data.expiresAtMs,
  });
  // Attempt repeated verification on already-Paid order
  const repeatedVerifyRes = await postJson('/api/orders/verify-payment', {
    orderNumber: paidOrderRes.data.orderNumber,
    callerUid: pkOwnerId,
    callerRole: 'seller',
    newStatus: 'Paid',
    statementConfirmed: true,
  });
  record(
    'TEST-6',
    'Seller Statement Confirmation → Labeled "Manually Verified by Seller" → Unlocks Buyer Download & Blocks Repeat Verification',
    sellerVerifyRes.status === 200 &&
      sellerVerifyRes.data.verificationMode === 'Manually Verified by Seller' &&
      authorizedDownloadAttempt.status === 200 &&
      authorizedDownloadAttempt.data.allowed === true &&
      repeatedVerifyRes.status === 409,
    `VerificationMode="${sellerVerifyRes.data.verificationMode}", AuthorizedDownload=${authorizedDownloadAttempt.data.allowed}, RepeatVerifyBlocked=${repeatedVerifyRes.status}`
  );

  // TEST 7: Cross-Seller Isolation (Seller B Attempts to Modify Seller A's Product, Order, or Ledger)
  const inOwnerId = inStoreRes.data.store.ownerId;
  const crossProdEdit = await postJson('/api/products/save', {
    callerUid: inOwnerId, // Indian seller trying to overwrite Pakistani seller's product
    product: {
      id: `prod-paid-pk-${uniqueSuffix}`,
      storeId: pkStoreId,
      ownerId: pkOwnerId,
      title: 'Hacked Title',
      priceUsd: 1,
      pricePkr: 100,
    },
  });
  const crossLedgerRead = await getJson(
    `/api/ledger?callerUid=${inOwnerId}&callerRole=seller`
  );
  const leakedPkOrders = (crossLedgerRead.data.entries || []).filter(
    (e) => e.sellerId === pkOwnerId
  );
  record(
    'TEST-7',
    'Cross-Seller Isolation: Seller B Cannot Modify Seller A Products or View Seller A Ledger',
    crossProdEdit.status === 403 && leakedPkOrders.length === 0,
    `CrossProductEditStatus=${crossProdEdit.status} ("${crossProdEdit.data.error}") | LeakedPKOrdersToINSeller=${leakedPkOrders.length}`
  );

  // TEST 8: Unauthorized User Attempts to Download Paid File (Wrong Buyer ID, Tampered Token, Cross-Product Token)
  const wrongBuyerAttempt = await postJson('/api/delivery/verify-download', {
    orderNumber: paidOrderRes.data.orderNumber,
    productId: `prod-paid-pk-${uniqueSuffix}`,
    buyerId: 'unauthorized-attacker-uid',
    paymentStatus: 'Paid',
    downloadToken: sellerVerifyRes.data.downloadToken,
    downloadCount: 1,
    maxDownloads: 5,
    expiresAtMs: paidOrderRes.data.expiresAtMs,
  });
  const tamperedTokenAttempt = await postJson('/api/delivery/verify-download', {
    orderNumber: paidOrderRes.data.orderNumber,
    productId: `prod-paid-pk-${uniqueSuffix}`,
    buyerId: `buyer-paid-${uniqueSuffix}`,
    paymentStatus: 'Paid',
    downloadToken: 'dstok_9999999999999_forgedhexsignature',
    downloadCount: 1,
    maxDownloads: 5,
    expiresAtMs: paidOrderRes.data.expiresAtMs,
  });
  record(
    'TEST-8',
    'Unauthorized Access Blocked: Wrong Buyer Identity & Tampered Download Tokens Rejected (403)',
    wrongBuyerAttempt.status === 403 && tamperedTokenAttempt.status === 403,
    `WrongBuyerStatus=${wrongBuyerAttempt.status} | TamperedTokenStatus=${tamperedTokenAttempt.status}`
  );

  // TEST 9: Duplicate Order Submission Prevention (Idempotency Key Guard)
  const duplicateOrderAttempt = await postJson('/api/checkout/validate-and-prepare', {
    idempotencyKey: `idem-paid-${uniqueSuffix}`, // Same idempotencyKey as TEST-5!
    buyerId: `buyer-paid-${uniqueSuffix}`,
    sellerId: pkOwnerId,
    storeId: pkStoreId,
    customerEmail: 'buyer.paid@dreamstore.test',
    currency: 'PKR',
    paymentMethod: 'jazzcash',
    paymentReference: `JC-TID-${uniqueSuffix}`,
    items: [
      {
        id: `prod-paid-pk-${uniqueSuffix}`,
        title: 'Complete Freelance Designer Blueprint (Paid PDF)',
        isFree: false,
        priceUsd: 10,
        pricePkr: 1000,
        quantity: 1,
      },
    ],
  });
  record(
    'TEST-9',
    'Duplicate Order Submission Prevented by Server Idempotency Guard (409 Conflict)',
    duplicateOrderAttempt.status === 409 && duplicateOrderAttempt.data.duplicate === true,
    `DuplicateRequestStatus=${duplicateOrderAttempt.status}, ExistingOrder=${duplicateOrderAttempt.data.orderNumber}`
  );

  // TEST 10: Super Admin Authorization & Anti-Self-Assignment
  const sellerAdminSpoofAttempt = await postJson('/api/admin/commission-config', {
    callerEmail: `pk.${uniqueSuffix}@dreamstore.test`,
    callerRole: 'super_admin',
    newCommissionBps: 100,
  });
  const realAdminAttempt = await postJson('/api/admin/commission-config', {
    callerEmail: 'mateenfatima5958@gmail.com',
    callerRole: 'super_admin',
    newCommissionBps: 500,
  });
  record(
    'TEST-10',
    'Super Admin RBAC: Ordinary Sellers Denied (403); Authorized Super Admin Allowed (200)',
    sellerAdminSpoofAttempt.status === 403 && realAdminAttempt.status === 200,
    `OrdinarySellerSpoofStatus=${sellerAdminSpoofAttempt.status} | SuperAdminStatus=${realAdminAttempt.status} (${realAdminAttempt.data.commissionPercentage})`
  );

  // TEST 11: Commission Accounting — Outstanding vs Collected Revenue & Refund Reversal
  const ledgerSummaryBefore = await getJson(
    `/api/ledger?callerUid=${pkOwnerId}&callerRole=seller`
  );
  const outstandingBefore = ledgerSummaryBefore.data.summary.outstandingCommissionTotalMinor;
  const collectedBefore = ledgerSummaryBefore.data.summary.collectedPlatformRevenueMinor;
  const refundRes = await postJson('/api/orders/refund', {
    orderNumber: paidOrderRes.data.orderNumber,
    callerUid: pkOwnerId,
    callerRole: 'seller',
  });
  const downloadAfterRefund = await postJson('/api/delivery/verify-download', {
    orderNumber: paidOrderRes.data.orderNumber,
    productId: `prod-paid-pk-${uniqueSuffix}`,
    buyerId: `buyer-paid-${uniqueSuffix}`,
    paymentStatus: 'Paid',
    downloadToken: sellerVerifyRes.data.downloadToken,
    downloadCount: 1,
    maxDownloads: 5,
    expiresAtMs: paidOrderRes.data.expiresAtMs,
  });
  record(
    'TEST-11',
    'Commission Accounting & Refund Reversal: Outstanding Not Counted as Collected; Refund Revokes Download & Reverses 5% Fee',
    outstandingBefore === 5000 &&
      collectedBefore === 0 &&
      refundRes.status === 200 &&
      refundRes.data.ledgerEntry.commissionStatus === 'reversed' &&
      downloadAfterRefund.status === 403,
    `BeforeRefund: Outstanding=${outstandingBefore} minor (50 PKR), Collected=${collectedBefore} | AfterRefund: CommissionStatus=${refundRes.data.ledgerEntry?.commissionStatus}, DownloadAfterRefund=${downloadAfterRefund.status}`
  );

  // TEST 12: Built-In 6-Pillar Server Audit Runner
  const suiteRes = await postJson('/api/test-suite/run', {});
  record(
    'TEST-12',
    'Built-In 6-Pillar Server Security & Ledger Audit Runner (/api/test-suite/run)',
    suiteRes.status === 200 && suiteRes.data.allPassed === true,
    `AllPassed=${suiteRes.data.allPassed}, Checks=${suiteRes.data.results?.length}`
  );

  const passedCount = results.filter((r) => r.passed).length;
  console.log(`\n======================================================`);
  console.log(`TOTAL E2E & SECURITY AUDIT RESULTS: ${passedCount}/${results.length} PASSED`);
  console.log(`======================================================`);

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

runCompleteAuditSuite().catch((err) => {
  console.error('Audit execution error:', err);
  process.exit(1);
});
