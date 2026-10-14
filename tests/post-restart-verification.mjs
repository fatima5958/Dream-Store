import fs from 'node:fs';
import assert from 'node:assert/strict';

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

async function runPostRestartVerification() {
  console.log('================================================================================');
  console.log('DREAMSTORE POST-RESTART PASSWORD RESET VERIFICATION');
  console.log('================================================================================\n');

  const stateRaw = fs.readFileSync('/tmp/restart-test-state.json', 'utf8');
  const state = JSON.parse(stateRaw);

  const { testUserEmail2, consumedTokenA, unconsumedTokenB, userUid2 } = state;

  // 1. Audit Check: Server reloaded stable signing secret and consumed token registry
  const auditRes = await apiRequest('/api/auth/email/reset-audit');
  recordTest(
    '1. Post-Restart Audit: Stable signing secret and consumed registry active',
    auditRes.status === 200 &&
      auditRes.data?.stableSigningSecretActive === true &&
      auditRes.data?.consumedTokensCount > 0,
    `status=${auditRes.status} | secretLen=${auditRes.data?.signingSecretLength} | consumedCount=${auditRes.data?.consumedTokensCount}`
  );

  // 2. CRITICAL TEST: Token Replay After Server Restart
  // Token A was consumed BEFORE the server restart.
  // When an attacker attempts to replay Token A against the restarted server:
  // It MUST be rejected with HTTP 403 Forbidden (auth/reset-token-already-used)!
  const replayTokenAAfterRestart = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    body: {
      email: testUserEmail2,
      newPassword: 'PostRestartAttackPassword999!',
      resetToken: consumedTokenA,
    },
  });

  const replayBlockedAfterRestart =
    replayTokenAAfterRestart.status === 403 &&
    replayTokenAAfterRestart.data?.code === 'auth/reset-token-already-used';

  recordTest(
    '2. Token Replay After Server Restart: Consumed token strictly rejected across restart (403 Forbidden)',
    replayBlockedAfterRestart,
    `status=${replayTokenAAfterRestart.status} | code=${replayTokenAAfterRestart.data?.code} | error="${replayTokenAAfterRestart.data?.error}"`
  );

  // 3. CRITICAL TEST: Unconsumed Token Durability Across Server Restart
  // Token B was minted BEFORE restart and NOT yet consumed.
  // Because the signing secret is stable and storage is persistent,
  // the legitimate user CAN consume Token B after the restart!
  const postRestartNewPassword = 'PostRestartLegitimatePass777!';
  const consumeTokenBAfterRestart = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    body: {
      email: testUserEmail2,
      newPassword: postRestartNewPassword,
      resetToken: unconsumedTokenB,
    },
  });

  const tokenBConsumedSuccessfully =
    consumeTokenBAfterRestart.status === 200 &&
    consumeTokenBAfterRestart.data?.passwordUpdated === true;

  recordTest(
    '3. Unconsumed Token Durability Across Restart: Pre-restart minted token valid after reboot (200 OK)',
    tokenBConsumedSuccessfully,
    `status=${consumeTokenBAfterRestart.status} | passwordUpdated=${consumeTokenBAfterRestart.data?.passwordUpdated}`
  );

  // 4. Token B Replay After Consumption
  // Now that Token B was consumed post-restart, repeating it must fail
  const replayTokenB = await apiRequest('/api/auth/email/reset-password', {
    method: 'POST',
    body: {
      email: testUserEmail2,
      newPassword: 'TokenBReplayAttackPassword888!',
      resetToken: unconsumedTokenB,
    },
  });

  recordTest(
    '4. Post-Restart Token B Single-Use: Replay after consumption rejected (403 Forbidden)',
    replayTokenB.status === 403 && replayTokenB.data?.code === 'auth/reset-token-already-used',
    `status=${replayTokenB.status} | code=${replayTokenB.data?.code}`
  );

  // 5. Verify user can log in with new password set via Token B
  const signinWithNewPass = await apiRequest('/api/auth/email/signin', {
    method: 'POST',
    body: {
      email: testUserEmail2,
      password: postRestartNewPassword,
    },
  });

  const signinVerified =
    signinWithNewPass.status === 200 &&
    signinWithNewPass.data?.user?.email === testUserEmail2 &&
    signinWithNewPass.data?.user?.uid === userUid2;

  recordTest(
    '5. Existing User Login Post-Reset: Account credentials updated cleanly, UID preserved',
    signinVerified,
    `status=${signinWithNewPass.status} | uid=${signinWithNewPass.data?.user?.uid}`
  );

  console.log('\n================================================================================');
  console.log(`ALL ${tests.length} POST-RESTART SECURITY CHECKS PASSED.`);
  console.log('================================================================================\n');
}

runPostRestartVerification().catch((err) => {
  console.error('Fatal error in post-restart verification:', err);
  process.exit(1);
});
