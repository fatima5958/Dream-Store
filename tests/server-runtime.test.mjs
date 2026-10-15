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


test('store editing rejects failed saves, invalid slugs and client-controlled Pro bypasses', async t => {
  const failed = await boot(t, 'product-write-denied');
  const response = await request(failed, '/api/stores/update', { storeId: 'store-seller-test', updates: { storeName: 'Unsaved Name' } }, token());
  assert.equal(response.status, 503);
  assert.notEqual((await response.json()).ok, true);
  const healthy = await boot(t);
  assert.equal((await request(healthy, '/api/stores/update', { storeId: 'store-seller-test', updates: { storeSlug: 'admin' } }, token())).status, 400);
  assert.equal((await request(healthy, '/api/stores/update', { storeId: 'store-seller-test', updates: { exchangeRatePkr: -5 } }, token())).status, 400);
  assert.equal((await request(healthy, '/api/stores/update', { storeId: 'store-seller-test', enforceProEntitlement: false, updates: { theme: 'midnight-muse' } }, token())).status, 403);
  const saved = await request(healthy, '/api/stores/update', { storeId: 'store-seller-test', updates: { storeName: 'Saved Name' } }, token());
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).store.storeName, 'Saved Name');
});

test('admin bulk payment approval is blocked and store mutations fail closed', async t => {
  const origin = await boot(t);
  const adminToken = token('seller-test', { role: 'super_admin', superAdmin: true });
  const bulkPaid = await request(origin, '/api/admin/stores/control',
    { action: 'approve_all_pending_orders' }, adminToken);
  assert.equal(bulkPaid.status, 409);
  assert.notEqual((await bulkPaid.json()).ok, true);
  const bulkStores = await request(origin, '/api/admin/stores/control',
    { action: 'activate_all_stores' }, adminToken);
  assert.equal(bulkStores.status, 409);
  const badStatus = await request(origin, '/api/admin/stores/status',
    { storeId: 'store-seller-test', status: 'arbitrary' }, adminToken);
  assert.equal(badStatus.status, 400);
  // Firebase test doubles reject updates; the API must not report success.
  const moderate = await request(origin, '/api/admin/stores/status',
    { storeId: 'store-seller-test', status: 'pending' }, adminToken);
  assert.equal(moderate.status, 503);
  assert.notEqual((await moderate.json()).ok, true);
  const pro = await request(origin, '/api/admin/subscriptions/grant-pro',
    { storeId: 'store-seller-test', grantPro: true }, adminToken);
  assert.equal(pro.status, 503);
  assert.notEqual((await pro.json()).ok, true);
});

test('unverified sellers cannot create a store or edit one', async t => {
  const origin = await boot(t);
  const unverified = token('seller-test', { email_verified: false });
  const created = await request(origin, '/api/stores/create', { storeName: 'Invalid', storeSlug: 'invalid' }, unverified);
  assert.equal(created.status, 403);
  assert.match((await created.json()).error, /Verify your email/);
  assert.equal((await request(origin, '/api/stores/update', {
    storeId: 'store-seller-test', updates: { storeName: 'No' },
  }, unverified)).status, 403);
});

test('suspended stores reject both upsert and editing despite cached records', async t => {
  const origin = await boot(t, 'suspended-store');
  const upsert = await request(origin, '/api/stores/create',
    { storeId: 'store-seller-test', storeName: 'Trying', storeSlug: 'test-shop' }, token());
  assert.equal(upsert.status, 403, JSON.stringify(await upsert.json()));
  const change = await request(origin, '/api/stores/update',
    { storeId: 'store-seller-test', updates: { storeName: 'Trying' } }, token());
  assert.equal(change.status, 403, JSON.stringify(await change.json()));
});

test('commission proof must have a durable invoice and valid reference', async t => {
  const origin = await boot(t);
  const missing = await request(origin, '/api/commission/submit-payment',
    { invoiceId: 'inv-unknown', paymentMethod: 'bank_transfer', paymentReference: 'TEST-123' }, token());
  assert.equal(missing.status, 404);
  assert.notEqual((await missing.json()).ok, true);
  const invalid = await request(origin, '/api/commission/submit-payment',
    { invoiceId: 'inv-unknown', paymentReference: '' }, token());
  assert.equal(invalid.status, 400);
  const spoof = await request(origin, '/api/commission/submit-payment',
    { invoiceId: 'inv-unknown', sellerId: 'other-seller', paymentReference: 'ABC-123' }, token());
  assert.equal(spoof.status, 403);
});

test('commission admin cannot auto-approve an invoice without a submitted proof and cleared funds', async t => {
  const origin = await boot(t);
  const admin = token('seller-test', { role: 'super_admin', superAdmin: true });
  assert.equal((await request(origin, '/api/admin/commission/verify-payment',
    { invoiceId: 'inv-example', decision: 'approve' }, admin)).status, 400);
  assert.equal((await request(origin, '/api/admin/commission/verify-payment',
    { paymentId: 'cpay-sample', invoiceId: 'inv-example', decision: 'approve' }, admin)).status, 400);
  const absent = await request(origin, '/api/admin/commission/verify-payment',
    { paymentId: 'cpay-sample', invoiceId: 'inv-example', decision: 'approve', fundsConfirmed: true }, admin);
  assert.equal(absent.status, 404);
  assert.notEqual((await absent.json()).ok, true);
});

test('seller cannot self-settle, reverse, or silently dispute commission', async t => {
  const origin = await boot(t);
  for (const status of ['paid', 'reversed']) {
    const attempt = await request(origin, '/api/ledger/commission-status',
      { orderNumber: 'DS-TEST-01', newCommissionStatus: status }, token());
    assert.equal(attempt.status, 409);
    assert.notEqual((await attempt.json()).ok, true);
  }
  assert.equal((await request(origin, '/api/ledger/commission-status',
    { orderNumber: 'DS-TEST-01', newCommissionStatus: 'disputed', note: 'bad' }, token())).status, 400);
});

test('subscription requests cannot locally activate Pro plans without server grants', async t => {
  const origin = await boot(t);
  const directPro = await request(origin, '/api/subscriptions',
    { status: 'Active', plan: 'Pro', storeId: 'store-seller-test' }, token());
  assert.equal(directPro.status, 409);
  assert.notEqual((await directPro.json()).ok, true);
  const simulated = await request(origin, '/api/commission/simulate-overdue', {}, token());
  // The production start entrypoint deliberately hides this test-only route.
  assert.equal(simulated.status, 404);
});

test('refund requires separately confirmed returned funds and a transfer reference', async t => {
  const origin = await boot(t);
  const refund = await request(origin, '/api/orders/refund',
    { orderNumber: 'DS-EXAMPLE', refundConfirmed: false }, token());
  assert.equal(refund.status, 400);
  assert.match((await refund.json()).error, /refunded funds/i);
});
