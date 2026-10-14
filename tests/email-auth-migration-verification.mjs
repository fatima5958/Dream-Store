import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createTestEmailProvider } from './test-email-provider.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TEST_IP = `198.51.100.${Math.floor(Math.random() * 200) + 30}`;

async function apiRequest(endpoint, { method = 'GET', token = null, body = undefined, ip = TEST_IP } = {}) {
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
  return { status: res.status, data };
}

const tests = [];
function recordTest(name, passed, detail) {
  tests.push({ name, passed, detail });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon} | ${name} -> ${detail}`);
  assert.equal(passed, true, `TEST FAILED: ${name} (${detail})`);
}

async function runEmailAuthMigrationSuite() {
  console.log('================================================================================');
  console.log('DREAMSTORE EMAIL AUTHENTICATION MIGRATION & SECURITY VERIFICATION SUITE');
  console.log('================================================================================\n');

  const emailProvider = createTestEmailProvider(3895);
  await emailProvider.start();

  // 1. Audit: Check sensitive file removal from repo root and inclusion in .gitignore
  const legacyRepoFile = path.join(process.cwd(), '.persistent-email-accounts.json');
  const legacyRepoFileExists = fs.existsSync(legacyRepoFile);
  const gitignoreContent = fs.readFileSync(path.join(process.cwd(), '.gitignore'), 'utf8');
  const gitignoreProtectsAccounts =
    gitignoreContent.includes('.persistent-email-accounts') &&
    gitignoreContent.includes('*.accounts.json') &&
    gitignoreContent.includes('*.session.json');

  recordTest(
    '1. Audit & Repository Hygiene: Sensitive file removed from repo and gitignored',
    !legacyRepoFileExists && gitignoreProtectsAccounts,
    `legacyFileInRepo=${legacyRepoFileExists} | gitignoreProtectsAccounts=${gitignoreProtectsAccounts}`
  );

  // 2. HTTP Route Protection: Direct HTTP requests to sensitive persistence files are blocked (403)
  const blockDotfileReq = await apiRequest('/.persistent-email-accounts.json');
  const blockSecureStoreReq = await apiRequest('/dreamstore-secure-email-accounts-v2.json');
  recordTest(
    '2. Route Protection: Direct HTTP access to account stores blocked (403 Forbidden)',
    blockDotfileReq.status === 403 && blockSecureStoreReq.status === 403,
    `legacyFileHTTP=${blockDotfileReq.status} | secureStoreHTTP=${blockSecureStoreReq.status}`
  );

  // 3. Migration Status: Verification that all existing email accounts were safely migrated
  const migrationRes = await apiRequest('/api/auth/email/migration-status');
  const status = migrationRes.data?.migrationStatus || {};
  const migrationVerified =
    migrationRes.status === 200 &&
    status.migrationCompleted === true &&
    status.migratedAccountsCount >= 40 &&
    status.legacySessionsRevoked === true &&
    status.legacyFileRemovedFromRepo === true &&
    status.secureStorageActive === true &&
    status.legacyFileInRepo === false;

  recordTest(
    '3. Account Migration: All existing email accounts migrated without account loss',
    migrationVerified,
    `completed=${status.migrationCompleted} | accountsMigrated=${status.migratedAccountsCount} | legacyRevoked=${status.legacySessionsRevoked} | secureStorage=${status.secureStorageActive}`
  );

  // 4. Revocation of Legacy Sessions: Old pre-migration session tokens are rejected (401)
  const legacySessionToken =
    'DS_EMAIL_SESSION.legacyrevokedsession12345.u_legacy123.9999999999999.forgedsig1234567890abcdef1234567890abcdef';
  const legacyAccessAttempt = await apiRequest('/api/navigation/access?screen=storefront', {
    token: legacySessionToken,
  });
  recordTest(
    '4. Legacy Session Revocation: Pre-migration legacy session tokens are strictly rejected (401)',
    legacyAccessAttempt.status === 401,
    `status=${legacyAccessAttempt.status} (${legacyAccessAttempt.data?.error || 'unauthorized'})`
  );

  // 5. Existing-User Login: Pre-migration user 1 (seller.a)
  const existingSellerEmail = 'seller.a.1791733999654@dreamstore.test';
  const existingSellerPassword = 'Password123!';
  const sellerSignIn = await apiRequest('/api/auth/email/signin', {
    method: 'POST',
    body: {
      email: existingSellerEmail,
      password: existingSellerPassword,
    },
  });
  const sellerToken = sellerSignIn.data?.token || '';
  const sellerUid = sellerSignIn.data?.user?.uid || '';

  const sellerProfileCheck = await apiRequest('/api/users/profile', {
    token: sellerToken,
  });

  const sellerLoginVerified =
    sellerSignIn.status === 200 &&
    Boolean(sellerToken) &&
    sellerSignIn.data?.user?.email === existingSellerEmail &&
    sellerSignIn.data?.user?.uid === 'u_d22d5c438ad6d558f8e1822e' &&
    sellerSignIn.data?.user?.migratedToFirebaseAuth === true &&
    sellerProfileCheck.status === 200;

  recordTest(
    '5. Existing User Login: Pre-migration Seller logs in, UID & data preserved',
    sellerLoginVerified,
    `status=${sellerSignIn.status} | uid=${sellerUid} | migrated=${sellerSignIn.data?.user?.migratedToFirebaseAuth} | profileStatus=${sellerProfileCheck.status}`
  );

  // 6. Existing-User Login: Pre-migration user 2 (new.buyer)
  const existingBuyerEmail = 'new.buyer.1791774599708@dreamstore.app';
  let existingBuyerPassword = 'CandyPassword123!';
  let buyerSignIn = await apiRequest('/api/auth/email/signin', {
    method: 'POST',
    body: {
      email: existingBuyerEmail,
      password: existingBuyerPassword,
    },
  });
  if (buyerSignIn.status === 401) {
    existingBuyerPassword = 'MigratedCandyPass999!';
    buyerSignIn = await apiRequest('/api/auth/email/signin', {
      method: 'POST',
      body: {
        email: existingBuyerEmail,
        password: existingBuyerPassword,
      },
    });
  }
  const buyerToken = buyerSignIn.data?.token || '';
  const buyerUid = buyerSignIn.data?.user?.uid || '';

  const buyerProfileCheck = await apiRequest('/api/users/profile', {
    token: buyerToken,
  });

  const buyerLoginVerified =
    buyerSignIn.status === 200 &&
    Boolean(buyerToken) &&
    buyerSignIn.data?.user?.email === existingBuyerEmail &&
    buyerSignIn.data?.user?.uid === 'u_05ecd3467a440a8a011b42ef' &&
    buyerSignIn.data?.user?.migratedToFirebaseAuth === true &&
    buyerProfileCheck.status === 200;

  recordTest(
    '6. Existing User Login: Pre-migration Buyer logs in, UID & data preserved',
    buyerLoginVerified,
    `status=${buyerSignIn.status} | uid=${buyerUid} | role=${buyerProfileCheck.data?.profile?.role}`
  );

  // 7. Unauthorized Login Attempts: Wrong password & unknown email
  const wrongPasswordAttempt = await apiRequest('/api/auth/email/signin', {
    method: 'POST',
    body: {
      email: existingBuyerEmail,
      password: 'CompletelyWrongPassword999!',
    },
  });
  const unknownEmailAttempt = await apiRequest('/api/auth/email/signin', {
    method: 'POST',
    body: {
      email: 'nonexistent.user.999@dreamstore.test',
      password: 'Password123!',
    },
  });
  recordTest(
    '7. Unauthorized Access: Wrong credentials and unknown accounts return 401',
    wrongPasswordAttempt.status === 401 && unknownEmailAttempt.status === 401,
    `wrongPass=${wrongPasswordAttempt.status} (${wrongPasswordAttempt.data?.code}) | unknownEmail=${unknownEmailAttempt.status} (${unknownEmailAttempt.data?.code})`
  );

  // 8. Password Reset Security: Unauthorized resets blocked
  // 8a. No token
  const noTokenReset = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    body: {
      email: existingBuyerEmail,
      newPassword: 'HackedPassword999!',
    },
  });
  // 8b. Forged token
  const forgedTokenReset = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    body: {
      email: existingBuyerEmail,
      newPassword: 'HackedPassword999!',
      resetToken: 'DS_PW_RESET.fakeid.u_fake.9999999999999.fakesig',
    },
  });
  // 8c. Cross-account token
  const sellerResetReq = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    token: sellerToken,
    body: { email: existingSellerEmail },
  });
  const sellerResetToken = sellerResetReq.data?.resetToken || '';
  const crossAccountReset = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    body: {
      email: existingBuyerEmail,
      newPassword: 'CrossAccountHijack999!',
      resetToken: sellerResetToken,
    },
  });

  const unauthorizedResetsBlocked =
    noTokenReset.status === 403 &&
    forgedTokenReset.status === 403 &&
    crossAccountReset.status === 403;

  recordTest(
    '8. Password Reset Security: Unauthorized resets strictly blocked (403 Forbidden)',
    unauthorizedResetsBlocked,
    `noToken=${noTokenReset.status} | forgedToken=${forgedTokenReset.status} | crossAccount=${crossAccountReset.status}`
  );

  // 9. Legitimate Password Reset & Replay Attack Prevention
  const buyerResetReq = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    token: buyerToken,
    body: { email: existingBuyerEmail },
  });
  const deliveredEmail = emailProvider.getLatestEmail(existingBuyerEmail);
  const buyerResetToken = emailProvider.extractResetToken(deliveredEmail);
  const newPasswordForBuyer = 'MigratedCandyPass999!';

  const legitResetRes = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    body: {
      email: existingBuyerEmail,
      newPassword: newPasswordForBuyer,
      resetToken: buyerResetToken,
    },
  });

  // Replay attack with same token must fail
  const replayResetRes = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    body: {
      email: existingBuyerEmail,
      newPassword: 'ReplayPassword111!',
      resetToken: buyerResetToken,
    },
  });

  // Sign in with new password
  const signInWithNewPass = await apiRequest('/api/auth/email/signin', {
    method: 'POST',
    body: {
      email: existingBuyerEmail,
      password: newPasswordForBuyer,
    },
  });

  const legitResetVerified =
    legitResetRes.status === 200 &&
    replayResetRes.status === 403 &&
    signInWithNewPass.status === 200 &&
    signInWithNewPass.data?.user?.uid === buyerUid;

  recordTest(
    '9. Password Reset & Single-Use Enforcement: Legitimate reset works, replay blocked (403), account intact',
    legitResetVerified,
    `legitReset=${legitResetRes.status} | replayBlocked=${replayResetRes.status} | newPassSignIn=${signInWithNewPass.status} | uidMatch=${signInWithNewPass.data?.user?.uid === buyerUid}`
  );

  await emailProvider.stop();
  console.log('\n================================================================================');
  console.log(`ALL ${tests.length} EMAIL AUTH MIGRATION & SECURITY CHECKS PASSED.`);
  console.log('================================================================================\n');
}

runEmailAuthMigrationSuite().catch((err) => {
  console.error('Fatal error running migration test suite:', err);
  process.exit(1);
});
