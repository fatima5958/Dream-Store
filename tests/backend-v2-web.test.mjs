import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selectFrontendBackend } from '../src/lib/backend-mode.ts';
import { createV2WebApp, validateV2WebBuild } from '../server/v2/web.ts';
import { createFirestoreProfileRepository } from '../server/v2/modules/users.ts';
import { createFirestoreStoreRepository } from '../server/v2/modules/stores.ts';
import { createFirestoreProductRepository } from '../server/v2/modules/products.ts';
import { MemoryFirestore, MemoryBucket } from './fixtures/v2-repositories.mjs';

const identity = { projectId: 'synthetic-project', firestoreDatabaseId: 'synthetic-named-db' };
function fixture() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'dreamstore-v2-web-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Synthetic V2 frontend</title>');
  fs.writeFileSync(path.join(dist, 'dreamstore-build.json'), JSON.stringify({ backend: 'v2', projectId: identity.projectId, databaseId: identity.firestoreDatabaseId }));
  const db = new MemoryFirestore(), bucket = new MemoryBucket();
  db.seed('users/seller-one', { role: 'seller', onboardingCompleted: true });
  db.seed('users/buyer-one', { role: 'buyer', onboardingCompleted: true });
  db.seed('users/new-seller', { role: 'seller', onboardingCompleted: true });
  db.seed('stores/store-seller-one', { ownerId: 'seller-one', storeSlug: 'one-books', storeName: 'One Books', status: 'Active', privateSecret: 'never-public' });
  db.seed('products/one-draft', { ownerId: 'seller-one', storeId: 'store-seller-one', title: 'Owner draft', published: false, status: 'Draft', fileDataUrl: 'storage://private' });
  db.seed('products/one-public', { ownerId: 'seller-one', storeId: 'store-seller-one', title: 'Public book', published: true, status: 'Available' });
  db.seed('stores/store-other', { ownerId: 'other', storeSlug: 'other-books', status: 'Active' });
  let paymentReads = 0;
  const deps = {
    auth: { async verifyBearer(token) {
      const uid = token.split('.')[1];
      return { uid, email: uid + '@example.test', emailVerified: uid !== 'unverified', displayName: uid };
    } },
    profiles: createFirestoreProfileRepository(db),
    stores: createFirestoreStoreRepository(db), products: createFirestoreProductRepository(db, bucket),
    creators: { async read() { return { limit: 100, claimed: 0, remaining: 100, soldOut: false, offer: 'free_storefront_setup' }; } },
    finance: { async paymentSettings(uid) { paymentReads++; return { ownerId: uid, bankTransferInstructions: 'Synthetic private instructions' }; } },
    readiness: { async check() { return true; } }, adminUid: 'admin', allowWrites: false,
  };
  return { dist, db, deps, paymentReads: () => paymentReads };
}
async function withServer(run) {
  const f = fixture();
  const app = createV2WebApp(f.deps, f.dist, identity);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const request = (route, uid) => fetch(origin + route, { headers: uid ? { Authorization: 'Bearer fixture.' + uid + '.signed' } : {} });
  try { await run({ ...f, request }); }
  finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(f.dist, { recursive: true, force: true }); }
}

test('frontend backend mode cannot be switched by runtime data or mix production and emulators', () => {
  assert.deepEqual(selectFrontendBackend({ PROD: true }), { productionV2: false, apiOnly: false });
  assert.deepEqual(selectFrontendBackend({ PROD: true, VITE_DREAMSTORE_BACKEND: 'v2' }), { productionV2: true, apiOnly: true });
  assert.deepEqual(selectFrontendBackend({ DEV: true, VITE_DREAMSTORE_V2_STAGING: '1' }), { productionV2: false, apiOnly: true });
  for (const candidate of [
    { PROD: true, VITE_DREAMSTORE_V2_STAGING: '1' },
    { DEV: true, VITE_DREAMSTORE_BACKEND: 'v2' },
    { PROD: true, VITE_DREAMSTORE_BACKEND: 'unknown' },
  ]) assert.throws(() => selectFrontendBackend(candidate));
});

test('V2 web startup refuses a missing, V1 or different-project frontend build', () => {
  const f = fixture();
  try {
    validateV2WebBuild(f.dist, identity);
    for (const patch of [{ backend: 'v1' }, { projectId: 'different-project' }, { databaseId: '(default)' }]) {
      fs.writeFileSync(path.join(f.dist, 'dreamstore-build.json'), JSON.stringify({ backend: 'v2', projectId: identity.projectId, databaseId: identity.firestoreDatabaseId, ...patch }));
      assert.throws(() => validateV2WebBuild(f.dist, identity));
    }
    fs.unlinkSync(path.join(f.dist, 'dreamstore-build.json'));
    assert.throws(() => validateV2WebBuild(f.dist, identity));
  } finally { fs.rmSync(f.dist, { recursive: true, force: true }); }
});

test('same-origin UI and V2 API are distinct; API failures and auth helpers never return SPA HTML', async () => {
  await withServer(async ({ request }) => {
    const page = await request('/?screen=owner-dashboard');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Synthetic V2 frontend/);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    const health = await request('/api/health');
    assert.equal((await health.json()).status, 'ok');
    const missing = await request('/api/not-implemented');
    assert.equal(missing.status, 501);
    assert.match(missing.headers.get('content-type'), /json/);
    assert.equal((await request('/__/auth/handler')).status, 404);
    assert.equal((await request('/assets/missing.js')).status, 404);
  });
});

test('seller snapshot restores owned drafts and settings without exposing deliverable references', async () => {
  await withServer(async ({ request }) => {
    const response = await request('/api/account/store', 'seller-one');
    assert.equal(response.status, 200);
    const snapshot = await response.json();
    assert.equal(snapshot.store.storeId, 'store-seller-one');
    assert.equal(snapshot.products.length, 2);
    assert.ok(snapshot.products.some(p => p.published === false));
    assert.equal(snapshot.settings.ownerId, 'seller-one');
    assert.equal(JSON.stringify(snapshot).includes('storage://private'), false);
    assert.equal(JSON.stringify(snapshot).includes('never-public'), false);
    const guest = await request('/api/stores/by-slug/one-books');
    const visible = await guest.json();
    assert.equal(visible.products.length, 1);
    assert.equal(visible.products[0].id, 'one-public');
  });
});

test('guest, Buyer and unverified identities cannot access Seller snapshots; query cannot select another store', async () => {
  await withServer(async ({ request, paymentReads }) => {
    assert.equal((await request('/api/account/store')).status, 401);
    assert.equal((await request('/api/account/store', 'buyer-one')).status, 403);
    assert.equal((await request('/api/account/store', 'unverified')).status, 403);
    assert.equal(paymentReads(), 0);
    const response = await request('/api/account/store?storeId=store-other', 'seller-one');
    assert.equal((await response.json()).store.ownerId, 'seller-one');
    const fresh = await request('/api/account/store', 'new-seller');
    assert.deepEqual(await fresh.json(), { store: null, products: [], settings: null });
  });
});
