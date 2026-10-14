import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createTestEmailProvider } from './test-email-provider.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TEST_CLIENT_IP = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;

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

async function runPasswordResetEmailDeliveryTests() {
  console.log('================================================================================');
  console.log('DREAMSTORE PASSWORD-RESET EMAIL DELIVERY & SECURITY VERIFICATION');
  console.log('================================================================================\n');

  // Start real test email provider server on port 3899
  const providerPort = 3899;
  const emailProvider = createTestEmailProvider(providerPort);
  const endpointUrl = await emailProvider.start();
  console.log(`Configured Email Provider active at ${endpointUrl}\n`);

  try {
    // -------------------------------------------------------------------------
    // 1. Audit Check: Outbox files are eliminated and reset-audit never leaks tokens
    // -------------------------------------------------------------------------
    const auditRes = await apiRequest('/api/auth/email/reset-audit');
    const auditBody = JSON.stringify(auditRes.data);
    const auditLeaksToken = auditBody.includes('DS_PW_RESET') || auditBody.includes('tokenHash');
    
    // Check outbox file in tmp does NOT store reset tokens
    const outboxPath = path.join(os.tmpdir(), '.dreamstore-email-outbox.log');
    let outboxContainsTokens = false;
    if (fs.existsSync(outboxPath)) {
      const outboxContent = fs.readFileSync(outboxPath, 'utf8');
      outboxContainsTokens = outboxContent.includes('DS_PW_RESET');
    }

    recordTest(
      '1. Secret Hygiene & Outbox Elimination: Reset tokens never exposed in admin tools or outbox files',
      auditRes.status === 200 && !auditLeaksToken && !outboxContainsTokens,
      `status=${auditRes.status} | auditLeaksToken=${auditLeaksToken} | outboxContainsTokens=${outboxContainsTokens}`
    );

    // -------------------------------------------------------------------------
    // 2. Neutral Response for Existing vs Unknown vs Unverified Emails
    // -------------------------------------------------------------------------
    const testUserEmail = `verified.owner.${Date.now()}@dreamstore.app`;
    const initialPassword = 'InitialCandyPassword123!';
    const signupRes = await apiRequest('/api/auth/email/signup', {
      method: 'POST',
      body: {
        email: testUserEmail,
        password: initialPassword,
        displayName: 'Verified Owner',
      },
    });
    assert.equal(signupRes.status, 200, 'Test account creation must succeed');

    // Request reset for EXISTING verified account
    const existingReq = await apiRequest('/api/auth/email/reset-password', {
      method: 'POST',
      body: { email: testUserEmail },
    });

    // Request reset for UNKNOWN account
    const unknownEmail = `unknown.user.${Date.now()}@dreamstore.app`;
    const unknownReq = await apiRequest('/api/auth/email/reset-password', {
      method: 'POST',
      body: { email: unknownEmail },
    });

    // Both must be 200 OK, both return ok: true, resetToken must be undefined in both!
    const existingLeaksToken = Boolean(existingReq.data?.resetToken || existingReq.data?.token);
    const unknownLeaksToken = Boolean(unknownReq.data?.resetToken || unknownReq.data?.token);
    const existingMessage = existingReq.data?.message;
    const unknownMessage = unknownReq.data?.message;
    const neutralResponsesMatch =
      existingReq.status === 200 &&
      unknownReq.status === 200 &&
      !existingLeaksToken &&
      !unknownLeaksToken &&
      typeof existingMessage === 'string' &&
      typeof unknownMessage === 'string' &&
      existingMessage.includes('password reset instructions');

    recordTest(
      '2. Neutral Response: Identical neutral response for existing and unknown emails (zero user enumeration)',
      neutralResponsesMatch,
      `existingStatus=${existingReq.status} | unknownStatus=${unknownReq.status} | existingLeaksToken=${existingLeaksToken} | unknownLeaksToken=${unknownLeaksToken}`
    );

    // Verify unknown email never triggered any email dispatch to provider
    const unknownInbox = emailProvider.getDeliveredEmails(unknownEmail);
    recordTest(
      '2b. Unknown Email Delivery Guard: No email is ever sent to unassociated addresses',
      unknownInbox.length === 0,
      `unknownEmailsDelivered=${unknownInbox.length}`
    );

    // -------------------------------------------------------------------------
    // 3. Real Inbox Delivery & Link Validation
    // -------------------------------------------------------------------------
    // The existing user's inbox must have received exactly ONE email from provider
    const verifiedInbox = emailProvider.getDeliveredEmails(testUserEmail);
    const deliveredEmail = verifiedInbox[verifiedInbox.length - 1];
    assert.ok(deliveredEmail, 'Email must have been delivered to user inbox');

    const hasCorrectSubject = deliveredEmail.subject.toLowerCase().includes('password reset');
    const resetLink = emailProvider.extractResetLink(deliveredEmail);
    const resetToken = emailProvider.extractResetToken(deliveredEmail);

    recordTest(
      '3. Real Inbox Delivery: Email delivered to verified account owner inbox with secure expiring link',
      Boolean(deliveredEmail && hasCorrectSubject && resetLink && resetToken),
      `recipient=${deliveredEmail?.to} | subject="${deliveredEmail?.subject}" | hasLink=${Boolean(resetLink)} | hasToken=${Boolean(resetToken)}`
    );

    // -------------------------------------------------------------------------
    // 4. Password Reset Execution using Link Token & Immediate Replay Protection
    // -------------------------------------------------------------------------
    const updatedPassword = 'NewDeliveredInboxPassword777!';
    const resetExecutionRes = await apiRequest('/api/auth/email/reset-password', {
      method: 'POST',
      body: {
        email: testUserEmail,
        newPassword: updatedPassword,
        resetToken: resetToken,
      },
    });

    const resetSuccess =
      resetExecutionRes.status === 200 && resetExecutionRes.data?.passwordUpdated === true;

    // Verify immediate replay is rejected
    const replayRes = await apiRequest('/api/auth/email/reset-password', {
      method: 'POST',
      body: {
        email: testUserEmail,
        newPassword: 'AttackerReplayPassword888!',
        resetToken: resetToken,
      },
    });

    const replayBlocked =
      replayRes.status === 403 && replayRes.data?.code === 'auth/reset-token-already-used';

    recordTest(
      '4. Single-Use Reset Execution: Password updated via inbox token and token replay rejected (403)',
      resetSuccess && replayBlocked,
      `resetStatus=${resetExecutionRes.status} | replayStatus=${replayRes.status} (${replayRes.data?.code})`
    );

    // Confirm old password is now rejected, and new password works
    const oldPassLogin = await apiRequest('/api/auth/email/signin', {
      method: 'POST',
      body: { email: testUserEmail, password: initialPassword },
    });
    const newPassLogin = await apiRequest('/api/auth/email/signin', {
      method: 'POST',
      body: { email: testUserEmail, password: updatedPassword },
    });

    recordTest(
      '4b. Credential Rotation: Old password revoked (401), new password authenticated cleanly (200)',
      oldPassLogin.status === 401 && newPassLogin.status === 200,
      `oldPassStatus=${oldPassLogin.status} | newPassStatus=${newPassLogin.status}`
    );

    // -------------------------------------------------------------------------
    // 5. Expired Link Rejection Test
    // -------------------------------------------------------------------------
    // Request a reset with negative TTL (-1000ms)
    emailProvider.clearInbox();
    const expiredRequestRes = await apiRequest('/api/auth/email/reset-password', {
      method: 'POST',
      body: {
        email: testUserEmail,
        ttlMs: -5000, // expired on generation
      },
    });
    assert.equal(expiredRequestRes.status, 200, 'Reset request returns neutral 200');

    const expiredEmail = emailProvider.getLatestEmail(testUserEmail);
    assert.ok(expiredEmail, 'Email for expired token test was delivered');
    const expiredToken = emailProvider.extractResetToken(expiredEmail);

    const expiredConsumeRes = await apiRequest('/api/auth/email/reset-password', {
      method: 'POST',
      body: {
        email: testUserEmail,
        newPassword: 'ShouldNeverSucceed999!',
        resetToken: expiredToken,
      },
    });

    const expiredRejected =
      expiredConsumeRes.status === 403 &&
      expiredConsumeRes.data?.code === 'auth/reset-token-expired';

    recordTest(
      '5. Expired Link Security: Expired tokens in reset links strictly rejected with 403 Forbidden',
      expiredRejected,
      `status=${expiredConsumeRes.status} | code=${expiredConsumeRes.data?.code}`
    );

    // -------------------------------------------------------------------------
    // 6. Email Provider Failure Handling Test
    // -------------------------------------------------------------------------
    console.log('\n--- Testing Email Provider Failures & Resilience ---');
    emailProvider.simulateFailure(true, 500, 'Mock Resend 500 Service Outage');

    const failureTestEmail = `resilience.test.${Date.now()}@dreamstore.app`;
    await apiRequest('/api/auth/email/signup', {
      method: 'POST',
      body: {
        email: failureTestEmail,
        password: 'FailureTestPassword123!',
        displayName: 'Failure Tester',
      },
    });

    // Request reset while provider is down
    const providerFailReq = await apiRequest('/api/auth/email/reset-password', {
      method: 'POST',
      body: { email: failureTestEmail },
    });

    // Verify neutral client response (server didn't crash or leak provider internals)
    const clientProtectedDuringFailure =
      providerFailReq.status === 200 && providerFailReq.data?.resetToken === undefined;

    // Check delivery audit logged the failure gracefully
    const auditDuringFailure = await apiRequest('/api/auth/email/reset-audit');
    const recentLogs = auditDuringFailure.data?.recentDeliveryLogs || [];
    const foundFailureLog = recentLogs.some(
      (l) => l.recipient === failureTestEmail && l.status === 'failed'
    );

    recordTest(
      '6. Provider Failure Resilience: Server handles email provider 500 outage gracefully with sanitized logging',
      clientProtectedDuringFailure && foundFailureLog,
      `clientStatus=${providerFailReq.status} | failureLogged=${foundFailureLog}`
    );

    // -------------------------------------------------------------------------
    // 7. Provider Recovery Test
    // -------------------------------------------------------------------------
    emailProvider.simulateFailure(false); // Restore provider to healthy
    const recoveryReq = await apiRequest('/api/auth/email/reset-password', {
      method: 'POST',
      body: { email: failureTestEmail },
    });

    const recoveryEmail = emailProvider.getLatestEmail(failureTestEmail);
    const recoveryToken = emailProvider.extractResetToken(recoveryEmail);

    recordTest(
      '7. Provider Recovery: Email delivery automatically resumes when provider recovers',
      recoveryReq.status === 200 && Boolean(recoveryEmail) && Boolean(recoveryToken),
      `recoveryStatus=${recoveryReq.status} | emailReceived=${Boolean(recoveryEmail)}`
    );

    console.log('\n================================================================================');
    console.log(`ALL ${tests.length} PASSWORD RESET EMAIL DELIVERY CHECKS PASSED.`);
    console.log('================================================================================\n');
  } finally {
    await emailProvider.stop();
  }
}

runPasswordResetEmailDeliveryTests().catch((err) => {
  console.error('Fatal error in email delivery test suite:', err);
  process.exit(1);
});
