import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
function token(sub = 'seller-test', claims = {}) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256', kid: 'fixture' })}.${encode({ sub, aud: config.projectId,
    iss: `https://securetoken.google.com/${config.projectId}`, exp: Math.floor(Date.now() / 1000) + 600,
    auth_time: Math.floor(Date.now() / 1000), ...claims })}.test-signature`;
}
async function boot(t, scenario = 'healthy', secret = 'test-only-signing-secret-with-over-32-characters') {
  const child = spawn(process.execPath, ['--import', './tests/fixtures/register-firebase.mjs', 'scripts/start.mjs'], {
    cwd: root, env: { ...process.env, NODE_ENV: 'development', PORT: '0',
      SERVER_SIGNING_SECRET: secret, DOWNLOAD_SIGNING_SECRET: '', TOKEN_SIGNING_SECRET: '',
      DREAMSTORE_TEST_SCENARIO: scenario, SUPER_ADMIN_UID: 'seller-test',
      DREAMSTORE_PAID_CHECKOUT_ENABLED: 'false', DREAMSTORE_LEGACY_EMAIL_AUTH_ENABLED: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stderr.on('data', data => { logs += data; });
  t.after(() => new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  }));
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timeout: ' + logs)), 15000);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${logs}`)); });
    child.stdout.on('data', data => {
      logs += data;
      const port = logs.match(/server running on http:\/\/0\.0\.0\.0:(\d+)/)?.[1];
      if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); }
    });
  });
}
async function request(origin, path, body, authToken) {
  return fetch(origin + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(authToken ? { authorization: 'Bearer ' + authToken } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test('production entrypoint honors PORT, disables temporary auth, and does not expose diagnostics', async t => {
  const origin = await boot(t);
  const health = await request(origin, '/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(Object.keys(await health.json()).sort(), ['service', 'status', 'timestamp']);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  for (const endpoint of ['signup', 'signin', 'reset-password']) {
    assert.equal((await request(origin, '/api/auth/email/' + endpoint, {})).status, 410);
  }
  for (const endpoint of ['migration-status', 'reset-audit']) {
    assert.equal((await request(origin, '/api/auth/email/' + endpoint)).status, 401);
  }
  assert.equal((await request(origin, '/api/auth/email/migrate', {})).status, 401);
  assert.equal((await request(origin, '/api/downloads/token', { isFreeOrder: true })).status, 401);
  assert.equal((await request(origin, '/api/users/profile', { role: 'seller' }, 'DS_EMAIL_SESSION.old')).status, 401);
  assert.equal((await request(origin, '/api/users/profile', { role: 'seller' }, token('revoked-user'))).status, 401);
  assert.equal((await request(origin, '/api/admin/verify-session', undefined, token())).status, 403);
  assert.equal((await request(origin, '/api/webhooks/payoneer', { status: 'Paid' })).status, 503);
  assert.equal((await request(origin, '/api/unknown-endpoint')).status, 404);
  const malformed = await fetch(origin + '/api/users/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.match(malformed.headers.get('content-type'), /json/);
});

test('readiness fails without a stable production secret even when Firebase is reachable', async t => {
  const origin = await boot(t, 'healthy', '');
  assert.equal((await request(origin, '/api/ready')).status, 503);
  assert.equal((await request(origin, '/api/health')).status, 200);
});

test('permission failures cannot report saved roles, stores, or ready checkout', async t => {
  const origin = await boot(t, 'permission-denied');
  assert.equal((await request(origin, '/api/ready')).status, 503);
  const role = await request(origin, '/api/users/profile', { role: 'seller', displayName: 'Test Seller' }, token());
  assert.equal(role.status, 503);
  assert.match((await role.json()).error, /could not be saved securely/);
  const store = await request(origin, '/api/stores/create', { storeSlug: 'test-shop', storeName: 'Test Shop' }, token());
  assert.equal(store.status, 503);
  assert.match((await store.json()).error, /could not be saved securely/);
  assert.equal((await request(origin, '/api/orders/list', undefined, token())).status, 503);
});

for (const scenario of ['storage-missing', 'product-write-denied']) {
  test(`publishing fails when ${scenario}`, async t => {
    const origin = await boot(t, scenario);
    const result = await request(origin, '/api/products/upsert', {
      id: 'product-test', storeId: 'store-seller-test', ownerId: 'seller-test', title: 'Original Guide', category: 'Ebooks',
      isFree: true, priceUsd: 0, pricePkr: 0, published: true, status: 'Available',
      fileName: 'original.pdf', fileType: 'application/pdf',
      fileDataUrl: 'storage://deliverables/seller-test/product-test/original.pdf',
    }, token());
    const data = await result.json();
    assert.equal(result.status, 503, JSON.stringify(data));
    assert.notEqual(data.ok, true);
  });
}

test('forged forwarded headers cannot reset mutation rate limits', async t => {
  const origin = await boot(t);
  let response;
  for (let i = 0; i < 21; i++) response = await fetch(origin + '/api/downloads/token', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${i}` }, body: '{}',
  });
  assert.equal(response.status, 429);
});
