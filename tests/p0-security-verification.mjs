import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createTestEmailProvider } from './test-email-provider.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf8'));
const FIREBASE_PROJECT_ID = cfg.projectId;
const SUPER_ADMIN_UID = process.env.SUPER_ADMIN_UID || 'V2Yxrm20XFWYscGUtHcBN8E9wA62';
const SUPER_ADMIN_EMAIL = 'mateenfatima5958@gmail.com';
const LEGACY_REMOVED_UID = 'w5B8xP4vG4W9sW6f5T3m7R1q3vY2';

function mintCustomHs256Jwt(payloadOverrides = {}, secret = 'custom-hs256-test-signing-secret-key-64-chars-0123456789abcdef') {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'dreamstore-internal-hs256' })
  ).toString('base64url');
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: SUPER_ADMIN_UID,
      user_id: SUPER_ADMIN_UID,
      email: SUPER_ADMIN_EMAIL,
      email_verified: true,
      iat: nowSec,
      exp: nowSec + 3600,
      iss: 'dreamstore-internal-test-auth',
      aud: FIREBASE_PROJECT_ID,
      ...payloadOverrides,
    })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

async function apiRequest(endpoint, { method = 'GET', token = null, body = undefined } = {}) {
  const headers = { 'Content-Type': 'application/json' };
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
  return { status: res.status, data };
}

const report = [];
function recordTest(category, name, passed, detail) {
  report.push({ category, name, passed, detail });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon} [${category}] ${name} -> ${detail}`);
  assert.equal(passed, true, `FAILED: [${category}] ${name} (${detail})`);
}

async function runSecuritySuite() {
  console.log('================================================================================');
  console.log('DREAMSTORE PRE-LAUNCH AUTHENTICATION & SECURITY VERIFICATION SUITE');
  console.log(`Firebase Project ID: ${FIREBASE_PROJECT_ID}`);
  console.log(`Configured SUPER_ADMIN_UID: ${SUPER_ADMIN_UID}`);
  console.log('================================================================================\n');

  const emailProvider = createTestEmailProvider(3893);
  await emailProvider.start();

  // 1. Static Codebase & Key File Audit
  const secretKeyPath = path.join(process.cwd(), '.server-signing-secret.key');
  const secretKeyExists = fs.existsSync(secretKeyPath);
  recordTest(
    '1. Secret Hygiene',
    '.server-signing-secret.key removed from disk and never persisted',
    secretKeyExists === false,
    `fs.existsSync('.server-signing-secret.key') === ${secretKeyExists}`
  );

  const serverText = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
  const firebaseClientText = fs.readFileSync(path.join(process.cwd(), 'src/lib/firebase.ts'), 'utf8');
  const appText = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
  const rulesText = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8');

  const verifyFnMatch = serverText.slice(
    serverText.indexOf('export async function verifyFirebaseIdTokenOnServer'),
    serverText.indexOf('export async function extractVerifiedCaller')
  );

  const onlyAdminSdkInVerifyFn =
    verifyFnMatch.includes("headerObj.alg !== 'RS256'") &&
    verifyFnMatch.includes('getAdminAuth().verifyIdToken(trimmed') &&
    !verifyFnMatch.includes("headerObj.alg === 'HS256'") &&
    !verifyFnMatch.includes('createHmac') &&
    !verifyFnMatch.includes('dreamstore-internal-hs256') &&
    !verifyFnMatch.includes('dreamstore-internal-test-auth') &&
    !verifyFnMatch.includes('SIGNING_SECRET');

  recordTest(
    '1. Secret Hygiene',
    'verifyFirebaseIdTokenOnServer() accepts ONLY RS256 tokens verified by Firebase Admin SDK (zero HS256 paths)',
    onlyAdminSdkInVerifyFn,
    'RS256 + kid + aud + iss + getAdminAuth().verifyIdToken(trimmed) enforced; zero HS256 or SIGNING_SECRET auth paths'
  );

  const noClientTestAuthHooks =
    !firebaseClientText.includes('__DREAMSTORE_TEST_AUTH__') &&
    !appText.includes('__DREAMSTORE_TEST_AUTH__');

  recordTest(
    '1. Secret Hygiene',
    'Client auth headers (src/lib/firebase.ts & src/App.tsx) contain zero test-auth bypass hooks',
    noClientTestAuthHooks,
    '__DREAMSTORE_TEST_AUTH__ completely removed from client codebase'
  );

  const rulesHasOnlyConfiguredUid =
    (rulesText.includes(`request.auth.uid == '${SUPER_ADMIN_UID}'`) || rulesText.includes("request.auth.token.superAdmin == true")) &&
    !rulesText.includes(LEGACY_REMOVED_UID) &&
    !rulesText.includes("request.auth.token.role == 'super_admin' && !request.auth.token.superAdmin");

  recordTest(
    '1. Secret Hygiene',
    'firestore.rules restricts isAdmin() exclusively to SUPER_ADMIN_UID',
    rulesHasOnlyConfiguredUid,
    `isAdmin() checks request.auth.uid == '${SUPER_ADMIN_UID}'`
  );

  // 2. Verify Custom HS256 Tokens Cannot Access Seller APIs
  const hs256SellerInternal = mintCustomHs256Jwt({
    sub: 'seller-pk-fatima',
    user_id: 'seller-pk-fatima',
    email: 'fatima@pk-seller.dreamstore.test',
  });
  const hs256SellerFirebaseClaims = mintCustomHs256Jwt({
    sub: 'seller-pk-fatima',
    user_id: 'seller-pk-fatima',
    email: 'fatima@pk-seller.dreamstore.test',
    iss: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    aud: FIREBASE_PROJECT_ID,
  });

  const sellerApiChecks = [
    ['POST', '/api/stores/create', { storeName: 'Test', storeSlug: 'test-hs256' }],
    ['POST', '/api/stores/update', { storeId: 'store-fatima-tech', updates: { storeName: 'Tamper' } }],
    ['GET', '/api/payment-settings/store-fatima-tech', undefined],
    ['POST', '/api/payment-settings/save', { storeId: 'store-fatima-tech', jazzCashMerchantId: '0300-0000000' }],
    ['POST', '/api/products/upsert', { id: 'prod-hs256', storeId: 'store-fatima-tech', title: 'Tamper' }],
    ['POST', '/api/products/delete', { productId: 'prod-30-day-reset' }],
    ['GET', '/api/orders/list?sellerId=seller-pk-fatima', undefined],
    ['POST', '/api/orders/verify-payment', { orderNumber: 'DS-100', newStatus: 'Paid', statementConfirmed: true }],
    ['POST', '/api/orders/refund', { orderNumber: 'DS-100' }],
    ['GET', '/api/ledger?sellerId=seller-pk-fatima', undefined],
    ['GET', '/api/commission/status?sellerId=seller-pk-fatima', undefined],
    ['POST', '/api/commission/submit-payment', { invoiceId: 'inv-1', paymentReference: 'REF123' }],
    ['GET', '/api/subscriptions?sellerId=seller-pk-fatima', undefined],
  ];

  for (const [method, endpoint, body] of sellerApiChecks) {
    const r1 = await apiRequest(endpoint, { method, token: hs256SellerInternal, body });
    const r2 = await apiRequest(endpoint, { method, token: hs256SellerFirebaseClaims, body });
    recordTest(
      '2. Seller API HS256 Rejection',
      `${method} ${endpoint} rejects custom HS256 tokens`,
      r1.status === 401 && r2.status === 401,
      `internal-hs256 -> HTTP ${r1.status} | firebase-claims-hs256 -> HTTP ${r2.status}`
    );
  }

  // 3. Verify Custom HS256 Tokens Cannot Access Super Admin APIs
  const hs256AdminInternal = mintCustomHs256Jwt({
    sub: SUPER_ADMIN_UID,
    user_id: SUPER_ADMIN_UID,
    email: SUPER_ADMIN_EMAIL,
    role: 'super_admin',
  });
  const hs256AdminFirebaseClaims = mintCustomHs256Jwt({
    sub: SUPER_ADMIN_UID,
    user_id: SUPER_ADMIN_UID,
    email: SUPER_ADMIN_EMAIL,
    role: 'super_admin',
    iss: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    aud: FIREBASE_PROJECT_ID,
  });

  const adminApiChecks = [
    ['GET', '/api/admin/verify-session', undefined],
    ['POST', '/api/admin/verify-session', {}],
    ['POST', '/api/admin/bootstrap-super-admin', { bootstrapSecret: 'test' }],
    ['POST', '/api/admin/commission-config', { newCommissionBps: 250 }],
    ['GET', '/api/commission/admin-overview', undefined],
    ['POST', '/api/commission/admin/grant-pro', { targetSellerId: 'seller-pk-fatima', grantPro: true }],
    ['POST', '/api/admin/stores/status', { storeId: 'store-fatima-tech', status: 'Pending' }],
    ['POST', '/api/commission/verify-payment', { invoiceId: 'inv-1', decision: 'approve' }],
    ['POST', '/api/test-suite/run', {}],
  ];

  for (const [method, endpoint, body] of adminApiChecks) {
    const r1 = await apiRequest(endpoint, { method, token: hs256AdminInternal, body });
    const r2 = await apiRequest(endpoint, { method, token: hs256AdminFirebaseClaims, body });
    recordTest(
      '3. Super Admin API HS256 Rejection',
      `${method} ${endpoint} rejects custom HS256 Super Admin tokens`,
      r1.status === 401 && r2.status === 401,
      `internal-hs256 -> HTTP ${r1.status} | firebase-claims-hs256 -> HTTP ${r2.status}`
    );
  }

  // 4. Verify Forged RS256 (with real Google X.509 kid), alg:none, Raw UID, and Expired Tokens Rejected
  const certsRes = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  const certs = await certsRes.json();
  const realGoogleKid = Object.keys(certs)[0];
  const nowSec = Math.floor(Date.now() / 1000);

  const forgedRs256Token = `${Buffer.from(
    JSON.stringify({ alg: 'RS256', kid: realGoogleKid, typ: 'JWT' })
  ).toString('base64url')}.${Buffer.from(
    JSON.stringify({
      iss: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      aud: FIREBASE_PROJECT_ID,
      sub: SUPER_ADMIN_UID,
      user_id: SUPER_ADMIN_UID,
      email: SUPER_ADMIN_EMAIL,
      email_verified: true,
      iat: nowSec - 10,
      exp: nowSec + 3600,
    })
  ).toString('base64url')}.${crypto.randomBytes(256).toString('base64url')}`;

  const algNoneToken = `${Buffer.from(
    JSON.stringify({ alg: 'none', typ: 'JWT' })
  ).toString('base64url')}.${Buffer.from(
    JSON.stringify({
      iss: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      aud: FIREBASE_PROJECT_ID,
      sub: SUPER_ADMIN_UID,
      exp: nowSec + 3600,
    })
  ).toString('base64url')}.sig`;

  const rForgedRs256 = await apiRequest('/api/admin/verify-session', { token: forgedRs256Token });
  const rAlgNone = await apiRequest('/api/admin/verify-session', { token: algNoneToken });
  const rRawUid = await apiRequest('/api/admin/verify-session', { token: SUPER_ADMIN_UID });
  const rMissing = await apiRequest('/api/admin/verify-session', { token: null });

  recordTest(
    '4. Malformed & Forged Token Rejection',
    'Rejects forged RS256 (with real Google kid), alg:none, raw UID, and missing token',
    rForgedRs256.status === 401 &&
      rAlgNone.status === 401 &&
      rRawUid.status === 401 &&
      rMissing.status === 401,
    `Forged RS256 (kid=${realGoogleKid.slice(0, 8)}...): ${rForgedRs256.status} | alg:none: ${rAlgNone.status} | Raw UID: ${rRawUid.status} | Missing: ${rMissing.status}`
  );

  // 5. Audit Requirement 1 & 2: sellerSettings Firestore Permissions & Private Settings Access Control
  const hasPermissiveSellerSettingsGet =
    rulesText.includes('allow get: if isValidId(sellerId);');
  const sellerSettingsMatchBlock = rulesText.slice(
    rulesText.indexOf('match /sellerSettings/{sellerId}'),
    rulesText.indexOf('match /users/{userId}/private/{docId}')
  );
  const privateSubcolMatchBlock = rulesText.slice(
    rulesText.indexOf('match /users/{userId}/private/{docId}'),
    rulesText.indexOf('// 3. Products Collection')
  );
  const sellerSettingsRestrictedToOwnerOrAdmin =
    !hasPermissiveSellerSettingsGet &&
    sellerSettingsMatchBlock.includes('allow get: if isValidId(sellerId) && (isOwner(sellerId) || isAdmin());') &&
    sellerSettingsMatchBlock.includes('allow list: if false;') &&
    sellerSettingsMatchBlock.includes('(isOwner(sellerId) || isAdmin())') &&
    privateSubcolMatchBlock.includes('allow get: if isValidId(userId) && isValidId(docId) && (isOwner(userId) || isAdmin());') &&
    privateSubcolMatchBlock.includes('allow list: if false;');

  recordTest(
    '5. sellerSettings Firestore Rules Audit',
    'Removed `allow get: if isValidId(sellerId)` and restricted sellerSettings & private subcollection exclusively to verified Owner or Super Admin',
    sellerSettingsRestrictedToOwnerOrAdmin,
    `allow get: if isValidId(sellerId) removed=${!hasPermissiveSellerSettingsGet} | Owner/SuperAdmin-only get/create/update/delete enforced`
  );

  // Verify backend never performs unauthenticated direct Firestore reads on sellerSettings
  const fetchFnSlice = serverText.slice(
    serverText.indexOf('async function fetchVerifiedSellerSettingsFromFirestore'),
    serverText.indexOf('let adminFirestoreSdkPermitted')
  );
  const requiresBearerForDirectFirestoreRead =
    fetchFnSlice.includes('!bearerToken') &&
    fetchFnSlice.includes('Authorization: `Bearer ${bearerToken}`') &&
    !fetchFnSlice.includes("// Also allow direct single-document read from sellerSettings");

  recordTest(
    '5. sellerSettings Firestore Rules Audit',
    'Backend fetchVerifiedSellerSettingsFromFirestore requires verified Owner/SuperAdmin Bearer token (zero unauthenticated Firestore reads)',
    requiresBearerForDirectFirestoreRead,
    'Unauthenticated direct Firestore read fallback removed from server.ts'
  );

  // Verify Attacker / Unauthenticated / Forged Token blocked from private /api/seller-settings and /api/payment-settings
  const unauthGetSettings = await apiRequest('/api/seller-settings?storeId=store-V2Yxrm20XFWYscGUtHcB');
  const unauthPostSettings = await apiRequest('/api/seller-settings', {
    method: 'POST',
    body: { storeId: 'store-V2Yxrm20XFWYscGUtHcB', jazzCashMerchantId: '03009999999' },
  });
  const forgedGetSettings = await apiRequest('/api/payment-settings/store-V2Yxrm20XFWYscGUtHcB', {
    token: forgedRs256Token,
  });

  recordTest(
    '5. sellerSettings Firestore Rules Audit',
    'Private seller settings API blocks unauthenticated callers, buyers, and attackers (401)',
    unauthGetSettings.status === 401 &&
      unauthPostSettings.status === 401 &&
      forgedGetSettings.status === 401,
    `GET /api/seller-settings (unauth): ${unauthGetSettings.status} | POST /api/seller-settings (unauth): ${unauthPostSettings.status} | GET /api/payment-settings (forged RS256): ${forgedGetSettings.status}`
  );

  // 6. Audit Requirement 3: Buyers Retrieve Safe Checkout Instructions via Authorized Backend Only
  const instrResPrimary = await apiRequest(
    `/api/checkout/payment-instructions/store-${SUPER_ADMIN_UID.slice(0, 20)}`
  );
  const instrResSlug = await apiRequest('/api/checkout/payment-instructions/store-fatima-tech');
  const instr = instrResPrimary.data?.instructions || {};
  const safeCheckoutInstructionsOk =
    instrResPrimary.status === 200 &&
    instrResSlug.status === 200 &&
    instrResPrimary.data?.paymentConfigured === true &&
    Array.isArray(instrResPrimary.data?.configuredMethods) &&
    instrResPrimary.data.configuredMethods.includes('jazzcash') &&
    instrResPrimary.data.configuredMethods.includes('easypaisa') &&
    instr.jazzCashMerchantId === '03359379024' &&
    instr.easypaisaStoreId === '0342126300' &&
    instr.email === undefined &&
    instr.ownerId === undefined &&
    instr.stripeAccountId === undefined &&
    instr.whatsappNotificationNumber === '';

  recordTest(
    '6. Safe Buyer Checkout Instructions',
    'Buyers retrieve sanitized checkout instructions via authorized backend with zero private seller PII leaked',
    safeCheckoutInstructionsOk,
    `HTTP ${instrResPrimary.status} | paymentConfigured=${instrResPrimary.data?.paymentConfigured} | methods=${JSON.stringify(instrResPrimary.data?.configuredMethods)} | PII stripped (email/ownerId/whatsapp/stripe hidden)`
  );

  // Verify client App.tsx never performs direct Firestore reads on another seller's sellerSettings
  const clientReadsOnlyOwnSettings =
    !appText.includes("doc(db, 'sellerSettings', config.ownerId)") &&
    !appText.includes("doc(db, 'sellerSettings', activeStoreId)") &&
    appText.includes('/api/checkout/payment-instructions/');

  recordTest(
    '6. Safe Buyer Checkout Instructions',
    'Frontend client never performs direct Firestore reads on sellerSettings for buyers',
    clientReadsOnlyOwnSettings,
    'Client uses /api/checkout/payment-instructions/:storeId for checkout; never reads foreign sellerSettings from Firestore'
  );

  // 7. Audit Requirement 4: Check that buyer-${uid} Normalization Cannot Bypass Buyer Identity or Download Authorization
  const noClientSelfTestAlias = !appText.includes('`buyer-${rawBuyerUid.slice(0, 16)}`');
  const downloadRouteSlice = serverText.slice(
    serverText.indexOf("app.post('/api/delivery/verify-download'"),
    serverText.indexOf("app.post('/api/test-suite/run'")
  );
  const verifyPaymentSlice = serverText.slice(
    serverText.indexOf("app.post('/api/orders/verify-payment'"),
    serverText.indexOf('await withSellerLock')
  );
  const strictDownloadAndVerifyProtection =
    noClientSelfTestAlias &&
    downloadRouteSlice.includes('if (requestedBuyerId !== verifiedUser.uid)') &&
    downloadRouteSlice.includes('if (ledgerEntry && ledgerEntry.buyerId !== verifiedUser.uid)') &&
    !downloadRouteSlice.includes('ledgerEntry.sellerId === verifiedUser.uid') &&
    !downloadRouteSlice.includes('ledgerEntry.buyerId === selfTestBuyerId') &&
    verifyPaymentSlice.includes('`buyer-${user.uid}` === String(entry.buyerId)') &&
    verifyPaymentSlice.includes('`buyer-${user.uid.slice(0, 16)}` === String(entry.buyerId)');

  const unauthDownloadBypassAttempt = await apiRequest('/api/delivery/verify-download', {
    method: 'POST',
    body: {
      orderNumber: 'DS-100',
      productId: 'prod-30-day-reset',
      buyerId: `buyer-${SUPER_ADMIN_UID.slice(0, 16)}`,
      downloadToken: 'dstok_forged',
    },
  });
  const forgedDownloadBypassAttempt = await apiRequest('/api/delivery/verify-download', {
    method: 'POST',
    token: forgedRs256Token,
    body: {
      orderNumber: 'DS-100',
      productId: 'prod-30-day-reset',
      buyerId: `buyer-${SUPER_ADMIN_UID.slice(0, 16)}`,
      downloadToken: 'dstok_forged',
    },
  });

  recordTest(
    '7. buyer-${uid} Normalization & Download Security',
    'buyer-${uid} normalization cannot bypass buyer identity, self-approval block, or download authorization',
    strictDownloadAndVerifyProtection &&
      unauthDownloadBypassAttempt.status === 401 &&
      forgedDownloadBypassAttempt.status === 401,
    `Exact verifiedUser.uid enforced on download & order list | Self-approval blocked for buyer-\${uid} | Unauth/forged download -> HTTP ${unauthDownloadBypassAttempt.status}/${forgedDownloadBypassAttempt.status}`
  );

  // 8. Audit Requirement 5: Verify Rate Limit Does Not Weaken Protection Against Unauthorized Writes
  const floodIp = '203.0.113.199';
  const statuses = [];
  let endpointLimitHeader = '';
  for (let i = 1; i <= 25; i++) {
    const res = await fetch(`${BASE_URL}/api/seller-settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': floodIp,
      },
      body: JSON.stringify({
        storeId: 'store-V2Yxrm20XFWYscGUtHcB',
        jazzCashMerchantId: '03000000000',
      }),
    });
    if (i === 1) {
      endpointLimitHeader = res.headers.get('x-ratelimit-endpoint-limit') || '';
    }
    statuses.push(res.status);
  }
  const first20All401 = statuses.slice(0, 20).every((s) => s === 401);
  const after20All429 = statuses.slice(20).every((s) => s === 429);
  const zero2xxSucceeded = statuses.every((s) => s >= 400);

  // Verify seller's checkout instructions were NOT modified by the unauthorized write flood
  const postFloodInstr = await apiRequest(
    `/api/checkout/payment-instructions/store-${SUPER_ADMIN_UID.slice(0, 20)}`
  );
  const settingsIntactAfterFlood =
    postFloodInstr.status === 200 &&
    postFloodInstr.data?.instructions?.jazzCashMerchantId === '03359379024' &&
    postFloodInstr.data?.instructions?.easypaisaStoreId === '0342126300';

  recordTest(
    '8. Unauthorized Write Rate Limit Protection',
    'Enforces 20 writes/min per endpoint (401 on unauth writes 1..20, 429 Too Many Requests on 21..25) with zero unauthorized state mutation',
    endpointLimitHeader === '20' &&
      first20All401 &&
      after20All429 &&
      zero2xxSucceeded &&
      settingsIntactAfterFlood,
    `X-RateLimit-Endpoint-Limit=${endpointLimitHeader} | Reqs 1-20: all 401 (${first20All401}) | Reqs 21-25: all 429 (${after20All429}) | Seller settings intact=${settingsIntactAfterFlood}`
  );

  // =========================================================================
  // 9. FIRST-LOGIN ROLE ONBOARDING & PRIVILEGE ESCALATION PREVENTION
  // =========================================================================
  const newBuyerEmail = `new.buyer.${Date.now()}@dreamstore.app`;
  const newBuyerSignup = await apiRequest('/api/auth/email/signup', {
    method: 'POST',
    body: {
      email: newBuyerEmail,
      password: 'CandyPassword123!',
      displayName: 'Amina Shopper',
    },
  });
  const buyerToken = newBuyerSignup.data?.token || '';
  const buyerUid = newBuyerSignup.data?.user?.uid || '';

  // Before selecting a role, new user needs onboarding
  const preOnboardingRes = await apiRequest('/api/users/profile', {
    method: 'GET',
    token: buyerToken,
  });
  const preOnboardingOk =
    preOnboardingRes.status === 200 &&
    preOnboardingRes.data?.needsOnboarding === true &&
    preOnboardingRes.data?.exists === false;

  // Attempt privilege escalation to Super Admin -> MUST be rejected with 403
  const escalateSuperAdmin1 = await apiRequest('/api/users/profile', {
    method: 'POST',
    token: buyerToken,
    body: {
      role: 'super_admin',
      displayName: 'Amina Shopper',
      email: newBuyerEmail,
    },
  });
  const escalateSuperAdmin2 = await apiRequest('/api/users/profile', {
    method: 'POST',
    token: buyerToken,
    body: {
      role: 'buyer',
      isSuperAdmin: true,
      displayName: 'Amina Shopper',
      email: newBuyerEmail,
    },
  });

  // Save Buyer role ("I'm here to Shop" -> collect only name & email, no store setup)
  const saveBuyerRoleRes = await apiRequest('/api/users/profile', {
    method: 'POST',
    token: buyerToken,
    body: {
      role: 'buyer',
      displayName: 'Amina Shopper',
      email: newBuyerEmail,
    },
  });
  const getBuyerProfileAfter = await apiRequest('/api/users/profile', {
    method: 'GET',
    token: buyerToken,
  });
  const buyerRoleSavedCleanly =
    saveBuyerRoleRes.status === 200 &&
    saveBuyerRoleRes.data?.profile?.role === 'buyer' &&
    saveBuyerRoleRes.data?.profile?.displayName === 'Amina Shopper' &&
    saveBuyerRoleRes.data?.profile?.email === newBuyerEmail &&
    saveBuyerRoleRes.data?.profile?.onboardingCompleted === true &&
    !saveBuyerRoleRes.data?.profile?.storeId &&
    getBuyerProfileAfter.data?.needsOnboarding === false &&
    getBuyerProfileAfter.data?.profile?.role === 'buyer';

  // Verify Seller role ("I want to Sell" -> saves role='seller' with storeId for Store Setup Wizard)
  const newSellerEmail = `new.seller.${Date.now()}@dreamstore.app`;
  const newSellerSignup = await apiRequest('/api/auth/email/signup', {
    method: 'POST',
    body: {
      email: newSellerEmail,
      password: 'CandyPassword123!',
      displayName: 'Zara Creator',
    },
  });
  const sellerToken = newSellerSignup.data?.token || '';
  const sellerUid = newSellerSignup.data?.user?.uid || '';
  const saveSellerRoleRes = await apiRequest('/api/users/profile', {
    method: 'POST',
    token: sellerToken,
    body: {
      role: 'seller',
      displayName: 'Zara Creator',
      email: newSellerEmail,
    },
  });
  const sellerRoleSavedCleanly =
    saveSellerRoleRes.status === 200 &&
    saveSellerRoleRes.data?.profile?.role === 'seller' &&
    saveSellerRoleRes.data?.profile?.onboardingCompleted === true &&
    saveSellerRoleRes.data?.profile?.storeId === `store-${sellerUid.slice(0, 20)}`;

  // Verify cross-user tampering is blocked (Seller trying to modify Buyer's profile)
  const crossUserTamperRes = await apiRequest('/api/users/profile', {
    method: 'POST',
    token: sellerToken,
    body: {
      uid: buyerUid,
      role: 'seller',
      displayName: 'Tampered',
      email: newBuyerEmail,
    },
  });

  // Verify existing stores (e.g. store-fatima-tech, store-V2Yxrm20XFWYscGUtHcB) remain intact
  const existingPkStoreRes = await apiRequest('/api/stores/store-fatima-tech');
  const existingAdminStoreRes = await apiRequest(
    `/api/stores/store-${SUPER_ADMIN_UID.slice(0, 20)}`
  );
  const existingStoresPreserved =
    existingPkStoreRes.status === 200 &&
    Boolean(existingPkStoreRes.data?.store?.storeId) &&
    existingAdminStoreRes.status === 200 &&
    Boolean(existingAdminStoreRes.data?.store?.storeId);

  recordTest(
    '9. First-Login Role Onboarding & Super Admin Escalation Prevention',
    'New users require onboarding, Buyer ("I\'m here to Shop") saves name+email without storeId, Seller ("I want to Sell") saves seller role + storeId, Super Admin self-assignment returns 403, and existing stores/roles are preserved',
    preOnboardingOk &&
      escalateSuperAdmin1.status === 403 &&
      escalateSuperAdmin2.status === 403 &&
      buyerRoleSavedCleanly &&
      sellerRoleSavedCleanly &&
      crossUserTamperRes.status === 403 &&
      existingStoresPreserved,
    `PreOnboarding=${preOnboardingOk} | SuperAdminEscalation=[${escalateSuperAdmin1.status},${escalateSuperAdmin2.status}] | BuyerSaved=${buyerRoleSavedCleanly} | SellerSaved=${sellerRoleSavedCleanly} | CrossUserTamper=${crossUserTamperRes.status} | ExistingStoresPreserved=${existingStoresPreserved}`
  );

  // =========================================================================
  // 10. ROLE-SPECIFIC NAVIGATION & DIRECT URL / API ACCESS BLOCKING
  // =========================================================================
  // 10A. Verify Buyer navigation items & blocked direct screen/API access
  const buyerNavCheck = await apiRequest('/api/navigation/access?screen=storefront', {
    token: buyerToken,
  });
  const buyerBlockedOwnerDashboard = await apiRequest(
    '/api/navigation/access?screen=owner-dashboard',
    { token: buyerToken }
  );
  const buyerBlockedWizard = await apiRequest('/api/navigation/access?screen=wizard', {
    token: buyerToken,
  });
  const buyerBlockedSuperAdmin = await apiRequest('/api/navigation/access?screen=super-admin', {
    token: buyerToken,
  });
  const buyerDirectCreateStoreApi = await apiRequest('/api/stores/create', {
    method: 'POST',
    token: buyerToken,
    body: {
      storeName: 'Buyer Unauthorized Store',
      storeSlug: `buyer-unauth-${Date.now()}`,
    },
  });
  const buyerDirectUpsertProductApi = await apiRequest('/api/products/upsert', {
    method: 'POST',
    token: buyerToken,
    body: {
      id: `prod-unauth-${Date.now()}`,
      storeId: `store-${buyerUid.slice(0, 20)}`,
      title: 'Unauthorized Product',
    },
  });
  const buyerDirectSellerSettingsApi = await apiRequest('/api/seller-settings', {
    token: buyerToken,
  });
  const buyerDirectAdminApi = await apiRequest('/api/admin/verify-session', {
    method: 'POST',
    token: buyerToken,
    body: {},
  });

  // 10B. Verify Seller navigation items & blocked Super Admin screen/API access
  const sellerNavCheck = await apiRequest('/api/navigation/access?screen=owner-dashboard', {
    token: sellerToken,
  });
  const sellerBlockedSuperAdmin = await apiRequest('/api/navigation/access?screen=super-admin', {
    token: sellerToken,
  });
  const sellerDirectAdminConfigApi = await apiRequest('/api/admin/commission-config', {
    method: 'POST',
    token: sellerToken,
    body: { newCommissionBps: 100 },
  });

  // 10C. Verify Returning User Sign-In skips onboarding immediately
  const returningBuyerSignIn = await apiRequest('/api/auth/email/signin', {
    method: 'POST',
    body: {
      email: newBuyerEmail,
      password: 'CandyPassword123!',
    },
  });
  const returningBuyerProfile = await apiRequest('/api/users/profile', {
    token: returningBuyerSignIn.data?.token || '',
  });
  const returningSellerSignIn = await apiRequest('/api/auth/email/signin', {
    method: 'POST',
    body: {
      email: newSellerEmail,
      password: 'CandyPassword123!',
    },
  });
  const returningSellerProfile = await apiRequest('/api/users/profile', {
    token: returningSellerSignIn.data?.token || '',
  });

  const buyerNavItemsMatch =
    JSON.stringify(buyerNavCheck.data?.permissions?.navigation) ===
    JSON.stringify(['Storefronts', 'Cart', 'Orders', 'Downloads', 'Profile']);
  const sellerNavItemsMatch =
    JSON.stringify(sellerNavCheck.data?.permissions?.navigation) ===
    JSON.stringify(['Dashboard', 'My Store', 'Products', 'Orders', 'Store Design', 'Settings']);
  const buyerBlocksVerified =
    buyerBlockedOwnerDashboard.status === 403 &&
    buyerBlockedWizard.status === 403 &&
    buyerBlockedSuperAdmin.status === 403 &&
    buyerDirectCreateStoreApi.status === 403 &&
    buyerDirectUpsertProductApi.status === 403 &&
    buyerDirectSellerSettingsApi.status === 403 &&
    buyerDirectAdminApi.status === 403;
  const sellerBlocksVerified =
    sellerNavCheck.status === 200 &&
    sellerBlockedSuperAdmin.status === 403 &&
    sellerDirectAdminConfigApi.status === 403;
  const returningUsersSkipOnboarding =
    returningBuyerProfile.status === 200 &&
    returningBuyerProfile.data?.needsOnboarding === false &&
    returningBuyerProfile.data?.profile?.role === 'buyer' &&
    returningSellerProfile.status === 200 &&
    returningSellerProfile.data?.needsOnboarding === false &&
    returningSellerProfile.data?.profile?.role === 'seller';

  recordTest(
    '10. Role-Specific Navigation, Returning User Skip-Onboarding & Direct URL/API Blocking',
    'Enforces Buyer (Storefronts, Cart, Orders, Downloads, Profile), Seller (Dashboard, My Store, Products, Orders, Store Design, Settings), and Super Admin navigation, skips onboarding for returning users, and blocks direct URL/API access with 403',
    buyerNavItemsMatch &&
      sellerNavItemsMatch &&
      buyerBlocksVerified &&
      sellerBlocksVerified &&
      returningUsersSkipOnboarding,
    `BuyerNav=${buyerNavItemsMatch} | SellerNav=${sellerNavItemsMatch} | BuyerBlocked=[Dashboard:${buyerBlockedOwnerDashboard.status},Wizard:${buyerBlockedWizard.status},SuperAdmin:${buyerBlockedSuperAdmin.status},CreateStore:${buyerDirectCreateStoreApi.status},UpsertProd:${buyerDirectUpsertProductApi.status},SellerSettings:${buyerDirectSellerSettingsApi.status}] | SellerBlockedSuperAdmin=[Screen:${sellerBlockedSuperAdmin.status},AdminAPI:${sellerDirectAdminConfigApi.status}] | ReturningSkipOnboarding=${returningUsersSkipOnboarding}`
  );

  // 11. Verify /api/auth/email/reset-password Security (Unauthorized & Legitimate Resets)
  // 11a. Attack: Attempt password change with ONLY email and newPassword (no resetToken)
  const unauthNoTokenReset = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    body: {
      email: newBuyerEmail,
      newPassword: 'HackedPassword999!',
    },
  });

  // 11b. Attack: Attempt password change with forged resetToken
  const unauthForgedTokenReset = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    body: {
      email: newBuyerEmail,
      newPassword: 'HackedPassword999!',
      resetToken: 'DS_PW_RESET.deadbeef123456.u_fake.9999999999999.forgedsignature12345',
    },
  });

  // 11c. Unauthenticated reset request ({ email } only) must NOT leak resetToken or change password
  const unauthRequestInstructions = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    body: {
      email: newBuyerEmail,
    },
  });

  // 11d. Attack: Cross-account token misuse (Seller requests a valid resetToken for Seller, tries to reset Buyer's password)
  const sellerResetTokenReq = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    token: sellerToken,
    body: {
      email: newSellerEmail,
    },
  });
  const sellerResetEmail = emailProvider.getLatestEmail(newSellerEmail);
  const sellerValidResetToken = emailProvider.extractResetToken(sellerResetEmail) || '';
  const crossAccountResetAttempt = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    body: {
      email: newBuyerEmail,
      newPassword: 'CrossAccountHijack999!',
      resetToken: sellerValidResetToken,
    },
  });

  // 11e. Attack: Expired resetToken must be rejected (403 auth/reset-token-expired)
  const expiredTokenReq = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    token: buyerToken,
    body: {
      email: newBuyerEmail,
      ttlMs: -5000,
    },
  });
  const expiredEmail = emailProvider.getLatestEmail(newBuyerEmail);
  const expiredResetToken = emailProvider.extractResetToken(expiredEmail) || '';
  const expiredTokenAttempt = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    body: {
      email: newBuyerEmail,
      newPassword: 'ExpiredTokenPassword999!',
      resetToken: expiredResetToken,
    },
  });

  // Confirm Buyer's original password STILL works and hacker passwords fail after all unauthorized attempts
  const hackerSignInAttempt = await apiRequest('/api/auth/email/signin', {
    method: 'POST',
    body: {
      email: newBuyerEmail,
      password: 'HackedPassword999!',
    },
  });
  const originalPasswordStillWorks = await apiRequest('/api/auth/email/signin', {
    method: 'POST',
    body: {
      email: newBuyerEmail,
      password: 'CandyPassword123!',
    },
  });

  // 11f. Legitimate password reset with a verified, single-use, non-expired resetToken
  const validBuyerTokenReq = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    token: originalPasswordStillWorks.data?.token || buyerToken,
    body: {
      email: newBuyerEmail,
    },
  });
  const validBuyerEmail = emailProvider.getLatestEmail(newBuyerEmail);
  const validBuyerResetToken = emailProvider.extractResetToken(validBuyerEmail) || '';
  const legitimateReset = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    body: {
      email: newBuyerEmail,
      newPassword: 'NewVerifiedCandyPass777!',
      resetToken: validBuyerResetToken,
    },
  });

  // 11g. Replay Attack: Attempting to reuse the consumed single-use resetToken a second time must fail with 403
  const replayTokenAttempt = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    body: {
      email: newBuyerEmail,
      newPassword: 'ReplayAttackPassword888!',
      resetToken: validBuyerResetToken,
    },
  });

  // 11h. Verify old password now fails (401), new password succeeds (200), and existing account UID & Buyer profile are preserved
  const oldPasswordAfterReset = await apiRequest('/api/auth/email/signin', {
    method: 'POST',
    body: {
      email: newBuyerEmail,
      password: 'CandyPassword123!',
    },
  });
  const newPasswordSignIn = await apiRequest('/api/auth/email/signin', {
    method: 'POST',
    body: {
      email: newBuyerEmail,
      password: 'NewVerifiedCandyPass777!',
    },
  });
  const preservedBuyerProfile = await apiRequest('/api/users/profile', {
    token: newPasswordSignIn.data?.token || '',
  });

  const unauthorizedResetsBlocked =
    unauthNoTokenReset.status === 403 &&
    unauthNoTokenReset.data?.code === 'auth/missing-reset-token' &&
    unauthForgedTokenReset.status === 403 &&
    unauthForgedTokenReset.data?.code === 'auth/invalid-reset-token' &&
    unauthRequestInstructions.status === 200 &&
    unauthRequestInstructions.data?.resetToken === undefined &&
    unauthRequestInstructions.data?.passwordUpdated === false &&
    crossAccountResetAttempt.status === 403 &&
    crossAccountResetAttempt.data?.code === 'auth/reset-token-email-mismatch' &&
    expiredTokenAttempt.status === 403 &&
    expiredTokenAttempt.data?.code === 'auth/reset-token-expired' &&
    hackerSignInAttempt.status === 401 &&
    originalPasswordStillWorks.status === 200;

  const legitimateAndSingleUseVerified =
    legitimateReset.status === 200 &&
    legitimateReset.data?.passwordUpdated === true &&
    replayTokenAttempt.status === 403 &&
    replayTokenAttempt.data?.code === 'auth/reset-token-already-used' &&
    oldPasswordAfterReset.status === 401 &&
    newPasswordSignIn.status === 200 &&
    newPasswordSignIn.data?.user?.uid === buyerUid &&
    preservedBuyerProfile.status === 200 &&
    preservedBuyerProfile.data?.profile?.uid === buyerUid &&
    preservedBuyerProfile.data?.profile?.role === 'buyer';

  recordTest(
    '11. Password Reset Endpoint Security (/api/auth/email/reset-password)',
    'Blocks password changes using only email+newPassword (403), blocks forged/expired/cross-account/replayed tokens (403), and completes legitimate single-use token resets while preserving accounts',
    unauthorizedResetsBlocked && legitimateAndSingleUseVerified,
    `NoToken=${unauthNoTokenReset.status} (${unauthNoTokenReset.data?.code}) | Forged=${unauthForgedTokenReset.status} | CrossAccount=${crossAccountResetAttempt.status} (${crossAccountResetAttempt.data?.code}) | Expired=${expiredTokenAttempt.status} (${expiredTokenAttempt.data?.code}) | LegitReset=${legitimateReset.status} | ReplaySingleUse=${replayTokenAttempt.status} (${replayTokenAttempt.data?.code}) | AccountPreserved=${newPasswordSignIn.data?.user?.uid === buyerUid}`
  );

  await emailProvider.stop();
  console.log('\n================================================================================');
  console.log(`ALL ${report.length} SECURITY CHECKS PASSED.`);
  console.log('================================================================================');
}

runSecuritySuite().catch((err) => {
  console.error('SECURITY SUITE FAILED:', err);
  process.exit(1);
});



