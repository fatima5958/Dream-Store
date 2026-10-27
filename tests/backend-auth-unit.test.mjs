import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirebaseVerifier, authenticatedPrincipal, isVerifiedSuperAdmin } from '../server/v2/modules/auth.ts';
import { ApiError, handleApiError } from '../server/v2/errors.ts';

const principal = { uid: 'buyer', email: 'buyer@example.test', emailVerified: true, displayName: 'Buyer' };
const request = (body = {}, token = 'valid.payload.signature') => ({ headers: { authorization: `Bearer ${token}` }, query: {}, body });
const deps = { auth: { verifyBearer: async () => principal } };

test('token verifier checks revocation and maps Firebase session failures', async () => {
  for (const code of ['auth/id-token-expired', 'auth/id-token-revoked', 'auth/invalid-id-token', 'auth/argument-error', 'auth/user-disabled']) {
    const verifier = createFirebaseVerifier({ async verifyIdToken(token, revoked) {
      assert.equal(token, 'test-token'); assert.equal(revoked, true);
      throw Object.assign(new Error('private provider detail'), { code });
    } });
    await assert.rejects(verifier.verifyBearer('test-token'), e => e.status === 401 && !e.message.includes('private'));
  }
});

test('public beta verifies signed Firebase tokens without production Admin revocation access', async () => {
  const verifier = createFirebaseVerifier({ async verifyIdToken(token, checkRevoked) {
    assert.equal(token, 'signed-token');
    assert.equal(checkRevoked, false);
    return { uid: 'new-user', email: 'user@example.test', email_verified: true };
  } }, { checkRevoked: false });
  const user = await verifier.verifyBearer('signed-token');
  assert.equal(user.uid, 'new-user');
  assert.equal(user.emailVerified, true);
});

test('IAM or network outages return 503 without converting them into sign-out', async () => {
  for (const code of ['auth/insufficient-permission', 'ECONNRESET']) {
    const verifier = createFirebaseVerifier({ async verifyIdToken() { throw Object.assign(new Error('secret'), { code }); } });
    await assert.rejects(verifier.verifyBearer('token'), e => e.status === 503 && e.code === 'auth/backend-unavailable');
  }
});

test('invalid signed subject cannot become a database path', async () => {
  for (const uid of ['', null, 'a/b', 'a\nb', 'x'.repeat(129)]) {
    const verifier = createFirebaseVerifier({ async verifyIdToken() { return { uid }; } });
    await assert.rejects(verifier.verifyBearer('token'), e => e.status === 401);
  }
});

test('privilege values are derived only from exact signed claim types', async () => {
  const verifier = createFirebaseVerifier({ async verifyIdToken() {
    return { uid: 'buyer', email_verified: 'true', role: 1, superAdmin: 'true' };
  } });
  const p = await verifier.verifyBearer('token');
  assert.equal(p.emailVerified, false); assert.equal(p.superAdminClaim, false); assert.equal(p.roleClaim, undefined);
});

test('missing/malformed/oversized bearers are rejected before any provider call', async () => {
  let calls = 0;
  const local = { auth: { async verifyBearer() { calls++; return principal; } } };
  const bad = ['', 'a..b', 'a.b.c.d', 'a.b.c ', ' a.b.c', 'a.b.\nc', 'a.b.' + 'x'.repeat(10000)];
  await assert.rejects(authenticatedPrincipal({ headers: {}, query: {}, body: {} }, local), e => e.status === 401);
  for (const token of bad) await assert.rejects(authenticatedPrincipal(request({}, token), local), e => e.status === 401);
  assert.equal(calls, 0);
});

test('identity hints cannot impersonate another buyer or owner', async () => {
  for (const key of ['uid', 'userId', 'ownerId', 'buyerId', 'callerUid']) {
    await assert.rejects(authenticatedPrincipal(request({ [key]: 'victim' }), deps), e => e.status === 403);
  }
  assert.equal((await authenticatedPrincipal(request({ buyerId: 'buyer' }), deps)).uid, 'buyer');
  // A checkout targets another seller; it must be resolved from the persisted product, not equated to buyer.
  assert.equal((await authenticatedPrincipal(request({ sellerId: 'seller' }), deps)).uid, 'buyer');
});

test('client role flags cannot elevate a verified account', async () => {
  for (const body of [{ role: 'super_admin' }, { superAdmin: true }, { selfAssignedAdmin: true }, { callerRole: 'super_admin' }]) {
    await assert.rejects(authenticatedPrincipal(request(body), deps), e => e.status === 403);
  }
});

test('admin requires configured identity, verified email and both signed claims', () => {
  const admin = { ...principal, roleClaim: 'super_admin', superAdminClaim: true };
  assert.equal(isVerifiedSuperAdmin(admin, 'buyer'), true);
  for (const uid of ['', 'another']) assert.equal(isVerifiedSuperAdmin(admin, uid), false);
  for (const extra of [{ emailVerified: false }, { roleClaim: 'seller' }, { superAdminClaim: false }]) {
    assert.equal(isVerifiedSuperAdmin({ ...admin, ...extra }, 'buyer'), false);
  }
});

function response(error) {
  const out = { headersSent: false, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  handleApiError(error, {}, out, () => {});
  return out;
}
test('invalid JSON and excessive payloads return useful safe 4xx responses', () => {
  for (const [type, status] of [['entity.parse.failed', 400], ['entity.too.large', 413]]) {
    const out = response({ type, status, body: 'private buyer data', message: 'secret' });
    assert.equal(out.code, status);
    assert.doesNotMatch(JSON.stringify(out.body), /private|secret/);
  }
});

test('expected authorization error preserves safe status and machine code', () => {
  const out = response(new ApiError(403, 'store/owner-forbidden', 'Access denied.'));
  assert.equal(out.code, 403); assert.equal(out.body.code, 'store/owner-forbidden');
});
