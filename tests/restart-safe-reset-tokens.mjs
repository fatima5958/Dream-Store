import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createTestEmailProvider } from './test-email-provider.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TEST_CLIENT_IP = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;

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
  return { status: res.status, data };
}

const tests = [];
function recordTest(name, passed, detail) {
  tests.push({ name, passed, detail });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon} | ${name} -> ${detail}`);
  assert.equal(passed, true, `TEST FAILED: ${name} (${detail})`);
}

async function runRestartSafeTestSuite() {
  console.log('================================================================================');
  console.log('DREAMSTORE RESTART-SAFE PASSWORD RESET & ATOMIC SINGLE-USE TEST SUITE');
  console.log('================================================================================\n');

  const emailProvider = createTestEmailProvider(3896);
  await emailProvider.start();

  // 1. Audit Check: Stable server-side signing secret is active and secure
  const auditRes = await apiRequest('/api/auth/email/reset-audit');
  recordTest(
    '1. Stable Server-Side Signing Secret',
    auditRes.status === 200 &&
      auditRes.data?.stableSigningSecretActive === true &&
      auditRes.data?.signingSecretLength === 64,
    `status=${auditRes.status} | active=${auditRes.data?.stableSigningSecretActive} | secretLen=${auditRes.data?.signingSecretLength}`
  );

  // 2. Token Issuance & Email Delivery Security:
  // Unauthenticated requests ({ email } only) must NOT expose token in JSON response
  const testUserEmail = `restart.test.${Date.now()}@dreamstore.app`;
  const initialPassword = 'InitialCandyPass123!';
  const signupRes = await apiRequest('/api/auth/email/signup', {
    method: 'POST',
    body: {
      email: testUserEmail,
      password: initialPassword,
      displayName: 'Restart Tester',
    },
  });
  const userToken = signupRes.data?.token;
  const userUid = signupRes.data?.user?.uid;

  // 2a. Public request with only email -> token is NOT returned in response
  const publicResetReq = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    body: { email: testUserEmail },
  });
  const publicDoesNotLeakToken =
    publicResetReq.status === 200 &&
    publicResetReq.data?.resetTokenSent === true &&
    publicResetReq.data?.resetToken === undefined;

  recordTest(
    '2. Secure Token Issuance & Email Delivery: Public reset request never leaks token in JSON',
    publicDoesNotLeakToken,
    `status=${publicResetReq.status} | resetTokenReturned=${Boolean(publicResetReq.data?.resetToken)} | message="${publicResetReq.data?.message}"`
  );

  // 2b. Delivery Audit: Outbox log records the dispatch
  const auditAfterPublic = await apiRequest('/api/auth/email/reset-audit');
  const logs = auditAfterPublic.data?.recentDeliveryLogs || [];
  const foundDispatch = logs.some((l) => l.recipient === testUserEmail);
  recordTest(
    '2b. Secure Delivery Audit: Outbox log registers secure email dispatch',
    foundDispatch,
    `dispatchesRecorded=${logs.length} | foundTargetRecipient=${foundDispatch}`
  );

  // 3. Authorized caller triggers secure reset email (token is delivered strictly to inbox, never returned in API response)
  const authResetReq = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    token: userToken,
    body: { email: testUserEmail },
  });
  const deliveredEmail = emailProvider.getLatestEmail(testUserEmail);
  const validResetToken = emailProvider.extractResetToken(deliveredEmail);
  const tokenNotLeakedInResponse = authResetReq.data?.resetToken === undefined;
  recordTest(
    '3. Secure Reset Token Issuance via Email Provider',
    authResetReq.status === 200 && Boolean(validResetToken) && tokenNotLeakedInResponse,
    `status=${authResetReq.status} | tokenInInbox=${Boolean(validResetToken)} | apiLeaksToken=${!tokenNotLeakedInResponse}`
  );

  // 4. Atomic Single-Use Enforcement: Simultaneous Concurrent Reset Requests
  console.log('\n--- Testing Simultaneous Concurrent Reset Requests (Race Condition Check) ---');
  const concurrentPassword1 = 'ConcurrentWinnerPass777!';
  const numConcurrent = 8;
  const concurrentPromises = [];
  for (let i = 0; i < numConcurrent; i++) {
    concurrentPromises.push(
      apiRequest('/api/auth/email/reset-password', {
        method: 'POST',
        body: {
          email: testUserEmail,
          newPassword: `ConcurrentAttemptPass_${i}_999!`,
          resetToken: validResetToken,
        },
      })
    );
  }

  const concurrentResults = await Promise.all(concurrentPromises);
  console.log('Concurrent results statuses:', concurrentResults.map((r) => `${r.status}(${r.data?.code || r.data?.error || ''})`));
  const successCount = concurrentResults.filter((r) => r.status === 200).length;
  const alreadyUsed403Count = concurrentResults.filter(
    (r) => r.status === 403 && (r.data?.code === 'auth/reset-token-already-used' || r.data?.error?.includes('already been used'))
  ).length;

  recordTest(
    '4. Atomic Single-Use with Simultaneous Concurrent Requests: Exactly ONE succeeds, all others 403',
    successCount === 1 && alreadyUsed403Count === numConcurrent - 1,
    `totalRequests=${numConcurrent} | successCount=${successCount} | alreadyUsed403Count=${alreadyUsed403Count}`
  );

  // 5. Verify the token cannot be reused immediately after consumption
  const immediateReplay = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    body: {
      email: testUserEmail,
      newPassword: 'ImmediateReplayPass888!',
      resetToken: validResetToken,
    },
  });
  recordTest(
    '5. Immediate Single-Use Replay Rejection: Token is consumed permanently',
    immediateReplay.status === 403 && immediateReplay.data?.code === 'auth/reset-token-already-used',
    `status=${immediateReplay.status} | code=${immediateReplay.data?.code}`
  );

  // 6. Test Restart Safety:
  // Step 6a: Issue a second token before server restart (unconsumed)
  // Step 6b: Save token to test post-restart consumption & post-restart replay
  console.log('\n--- Testing Token Durability Across Server Restarts ---');
  const testUserEmail2 = `restart.durability.${Date.now()}@dreamstore.app`;
  const signupRes2 = await apiRequest('/api/auth/email/signup', {
    method: 'POST',
    body: {
      email: testUserEmail2,
      password: 'DurabilityPass123!',
      displayName: 'Durability User',
    },
  });
  const userToken2 = signupRes2.data?.token;

  // Token A: Will be CONSUMED before restart, then tested for REPLAY after restart
  const tokenAReq = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    token: userToken2,
    body: { email: testUserEmail2 },
  });
  const emailA = emailProvider.getLatestEmail(testUserEmail2);
  const tokenA = emailProvider.extractResetToken(emailA);
  const consumeARes = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    body: {
      email: testUserEmail2,
      newPassword: 'PreRestartUpdatedPass456!',
      resetToken: tokenA,
    },
  });
  assert.equal(consumeARes.status, 200, 'Pre-restart token consumption must succeed');

  // Token B: Minted before restart, UNCONSUMED before restart, to be consumed AFTER restart
  const reloginRes = await apiRequest('/api/auth/email/signin', {
    method: 'POST',
    body: {
      email: testUserEmail2,
      password: 'PreRestartUpdatedPass456!',
    },
  });
  const freshUserToken2 = reloginRes.data?.token;

  const tokenBReq = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    token: freshUserToken2,
    body: { email: testUserEmail2 },
  });
  const emailB = emailProvider.getLatestEmail(testUserEmail2);
  const tokenB = emailProvider.extractResetToken(emailB);

  console.log('Token A consumed before restart. Token B minted unconsumed before restart.');
  console.log('Writing state to file for post-restart verification...');

  // Save tokens to /tmp/restart-test-state.json
  fs.writeFileSync(
    '/tmp/restart-test-state.json',
    JSON.stringify({
      testUserEmail,
      testUserEmail2,
      consumedTokenA: tokenA,
      unconsumedTokenB: tokenB,
      userUid2: signupRes2.data?.user?.uid,
    })
  );

  recordTest(
    '6. Pre-Restart Preparation: Token A consumed, Token B minted unconsumed',
    consumeARes.status === 200 && Boolean(tokenB),
    `TokenA_Consumed=${consumeARes.status === 200} | TokenB_Minted=${Boolean(tokenB)}`
  );

  await emailProvider.stop();
  console.log('\nReady for dev server restart. Run post-restart phase after server reboot.');
}

runRestartSafeTestSuite().catch((err) => {
  console.error('Fatal error in restart-safe test suite:', err);
  process.exit(1);
});
