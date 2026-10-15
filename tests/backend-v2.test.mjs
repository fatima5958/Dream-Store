import test from 'node:test';
import assert from 'node:assert/strict';
import { createV2App } from '../server/v2/app.ts';
import { createFirebaseVerifier } from '../server/v2/modules/auth.ts';
import { createFirestoreStoreRepository, publicStoreProjection } from '../server/v2/modules/stores.ts';

const principal = (uid, overrides = {}) => ({
  uid, email: uid + '@example.test', emailVerified: true,
  displayName: 'Test Account', ...overrides,
});
function fixture(options = {}) {
  const profiles = new Map();
  const calls = [];
  const deps = {
    auth: {
      async verifyBearer(token) {
        const caller = token.split('.')[1];
        return options.users?.[caller] || principal(caller);
      },
    },
    profiles: {
      async find(p) { return profiles.get(p.uid) || null; },
      async save(p, role, name) {
        calls.push({ uid: p.uid, role });
        const record = {
          uid: p.uid, role, displayName: name, email: p.email,
          onboardingCompleted: true,
          ...(role === 'seller' ? { storeId: 'store-' + p.uid.slice(0, 20) } : {}),
          createdAtIso: '2026-10-01T00:00:00.000Z',
          updatedAtIso: '2026-10-01T00:00:00.000Z',
        };
        profiles.set(p.uid, record);
        return record;
      },
    },
    creators: {
      async read() { return { limit: 100, claimed: 98, remaining: 2, soldOut: false, offer: 'free_storefront_setup' }; },
    },
    readiness: { async check() { return options.ready === true; } },
    adminUid: 'admin_uid',
    stores: options.stores,
    products: options.products,
    uploads: options.uploads,
    allowWrites: options.allowWrites === true,
  };
  const app = createV2App(deps);
  return { app, profiles, calls };
}
async function withServer(app, run) {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const request = async (path, token, body, method = body ? 'POST' : 'GET') => {
      const res = await fetch(base + path, {
        method,
        headers: {
          ...(token ? { authorization: 'Bearer fixture.' + token + '.signature' } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return [res.status, await res.json(), res.headers];
    };
    await run(request);
  } finally { await new Promise(r => server.close(r)); }
}

test('V2 staging health and readiness never claim Firebase success without it', async () => {
  const { app } = fixture();
  await withServer(app, async get => {
    const [status, health, headers] = await get('/api/health');
    assert.equal(status, 200);
    assert.equal(health.status, 'ok');
    assert.equal(headers.get('cache-control'), 'no-store');
    const [readyStatus, ready] = await get('/api/ready');
    assert.equal(readyStatus, 503);
    assert.deepEqual(ready, { status: 'not_ready' });
  });
});

test('V2 never grants a cached or client-declared role without backend verification', async () => {
  const { app, profiles } = fixture({ users: { buyer: principal('buyer') } });
  profiles.set('buyer', { uid: 'buyer', role: 'buyer', email: 'buyer@example.test',
    displayName: 'Buyer', onboardingCompleted: true, createdAtIso: '', updatedAtIso: '' });
  await withServer(app, async request => {
    assert.equal((await request('/api/users/profile'))[0], 401);
    assert.equal((await request('/api/admin/verify-session', 'buyer'))[0], 403);
    const [ok, data] = await request('/api/users/profile', 'buyer');
    assert.equal(ok, 200);
    assert.equal(data.profile.role, 'buyer');
    assert.equal((await request('/api/navigation/access?screen=owner-dashboard', 'buyer'))[0], 403);
    assert.equal((await request('/api/users/profile', 'buyer', { role: 'super_admin' }))[0], 403);
    assert.equal((await request('/api/users/profile', 'buyer', { role: 'seller', ownerId: 'other' }))[0], 403);
    assert.equal((await request('/api/checkout/validate-and-prepare', 'buyer', {}))[0], 501);
  });
});

test('V2 blocks onboarding mutations when not in isolated Firebase emulator', async () => {
  const { app, calls } = fixture();
  await withServer(app, async request => {
    const [status, data] = await request('/api/users/profile', 'buyer', { role: 'buyer', displayName: 'Buyer' });
    assert.equal(status, 503);
    assert.equal(data.code, 'backend/staging-readonly');
    assert.equal(calls.length, 0);
  });
});

test('V2 applies a process-local rate limit to repeated account writes', async () => {
  const { app } = fixture({ allowWrites: true });
  await withServer(app, async request => {
    for (let i = 0; i < 40; i++) {
      const [status] = await request('/api/users/profile', 'rate-limited-user', { role: 'buyer', displayName: 'Buyer' });
      assert.equal(status, 200);
    }
    const [status, body, headers] = await request('/api/users/profile', 'rate-limited-user', { role: 'buyer', displayName: 'Buyer' });
    assert.equal(status, 429);
    assert.equal(body.code, 'request/rate-limited');
    assert.equal(headers.get('retry-after') !== null, true);
  });
});

test('V2 Buyer/Seller onboarding preserves distinct roles and returning profiles', async () => {
  const { app, profiles, calls } = fixture({ allowWrites: true });
  await withServer(app, async request => {
    const [newStatus, newUser] = await request('/api/users/profile', 'seller');
    assert.equal(newStatus, 200);
    assert.equal(newUser.needsOnboarding, true);
    const [saveStatus, saved] = await request('/api/users/profile', 'seller', { role: 'seller', displayName: 'Creator' });
    assert.equal(saveStatus, 200);
    assert.equal(saved.profile.storeId, 'store-seller');
    assert.equal((await request('/api/users/profile', 'seller'))[1].profile.role, 'seller');
    assert.equal((await request('/api/users/profile', 'buyer', { role: 'buyer', displayName: 'Buyer' }))[0], 200);
    assert.equal((await request('/api/navigation/access?screen=owner-dashboard', 'seller'))[0], 200);
    assert.equal((await request('/api/navigation/access?screen=owner-dashboard', 'buyer'))[0], 403);
    assert.equal(calls.length, 2);
    assert.equal(profiles.size, 2);
  });
});

test('V2 admin requires both configured UID and signed verified Firebase custom claims', async () => {
  const { app } = fixture({ users: {
    admin: principal('admin_uid', { roleClaim: 'super_admin', superAdminClaim: true }),
    forged: principal('not_admin', { roleClaim: 'super_admin', superAdminClaim: true }),
    noClaim: principal('admin_uid'),
  }});
  await withServer(app, async request => {
    assert.equal((await request('/api/admin/verify-session', 'forged'))[0], 403);
    assert.equal((await request('/api/admin/verify-session', 'noClaim'))[0], 403);
    const [status, body] = await request('/api/admin/verify-session', 'admin');
    assert.equal(status, 200);
    assert.equal(body.isSuperAdmin, true);
    assert.equal((await request('/api/users/profile', 'admin'))[1].profile.role, 'super_admin');
  });
});

test('V2 reads creator counter without a claim mutation or fabricated progress', async () => {
  const { app } = fixture();
  await withServer(app, async request => {
    const [status, body] = await request('/api/launch/creator-spots');
    assert.equal(status, 200);
    assert.deepEqual([body.claimed, body.remaining, body.soldOut], [98, 2, false]);
    assert.equal((await request('/api/stores/create', 'creator', { storeName: 'No write' }))[0], 503);
  });
});

test('Firebase Admin validates signed and unrevoked tokens; outages are recoverable 503', async () => {
  const calls = [];
  const fakeAuth = {
    async verifyIdToken(token, checkRevoked) {
      calls.push([token, checkRevoked]);
      if (token === 'revoked') throw Object.assign(new Error('revoked'), { code: 'auth/id-token-revoked' });
      if (token === 'offline') throw Object.assign(new Error('offline'), { code: 'auth/insufficient-permission' });
      return { uid: 'signed_user', email: 'user@example.test', email_verified: true };
    },
  };
  const verify = createFirebaseVerifier(fakeAuth);
  assert.equal((await verify.verifyBearer('valid')).uid, 'signed_user');
  await assert.rejects(verify.verifyBearer('revoked'), e => e.status === 401);
  await assert.rejects(verify.verifyBearer('offline'), e => e.status === 503);
  assert.deepEqual(calls.map(x => x[1]), [true, true, true]);
});


test('V2 public directory is limited to active stores and never exposes Seller secrets', async () => {
  const fakeStore = {
    storeSlug: 'creator-books', storeName: 'Creator Books', ownerId: 'private_owner_uid',
    ownerEmail: 'seller@example.test', paymentLinkUrl: 'private-link',
    jazzCashMerchantId: 'private-merchant', bankTransferInstructions: 'private-bank',
    sellerCountry: 'Pakistan', currency: 'PKR', status: 'Active',
    passwordHash: 'never-public', theme: 'blush-rose',
  };
  const queryCalls = [];
  const db = {
    collection(name) {
      // Repository eagerly declares Slug/Campaign collections even when the
      // directory test only exercises its read-only stores query.
      if (name === 'store_slugs' || name === 'creator_launch_campaigns') {
        return { doc: () => ({}) };
      }
      assert.equal(name, 'stores');
      return {
        where(...args) {
          queryCalls.push(['where', ...args]);
          return {
            limit(count) {
              queryCalls.push(['limit', count]);
              return {
                async get() {
                  return { docs: [{ id: 'store-private-owner', data: () => fakeStore }] };
                },
              };
            },
          };
        },
      };
    },
  };
  const directory = createFirestoreStoreRepository(db);
  const listing = await directory.listPublic();
  assert.deepEqual(queryCalls, [['where', 'status', '==', 'Active'], ['limit', 100]]);
  assert.equal(listing.length, 1);
  const [publicStore] = listing;
  assert.equal(publicStore.storeSlug, 'creator-books');
  assert.equal(publicStore.storeId, 'store-private-owner');
  for (const secret of ['ownerEmail', 'paymentLinkUrl', 'jazzCashMerchantId',
    'bankTransferInstructions', 'passwordHash']) {
    assert.equal(Object.hasOwn(publicStore, secret), false, secret + ' must not leak');
  }
  const { app } = fixture({ stores: { listPublic: () => Promise.resolve(listing) } });
  await withServer(app, async request => {
    const [status, response] = await request('/api/stores');
    assert.equal(status, 200);
    assert.deepEqual(response, { stores: listing });
  });
});

test('publicStoreProjection excludes untrusted nested private data by default', () => {
  const projected = publicStoreProjection('store-seller', {
    storeName: 'Public Shop', status: 'Active', ownerEmail: 'private@example.test',
    nestedSettings: { paymentDetails: 'private' }, plan: 'Free',
    exchangeRatePkr: Infinity,
  });
  assert.deepEqual(projected, {
    storeId: 'store-seller', storeName: 'Public Shop', status: 'Active', plan: 'Free',
  });
});

test('V2 directory infrastructure failures are never misreported as empty stores', async () => {
  const { app } = fixture({
    stores: { async listPublic() { throw Object.assign(new Error('simulated database failure'), {
      code: 'permission-denied',
    }); } },
  });
  await withServer(app, async request => {
    const [status, response] = await request('/api/stores');
    assert.equal(status, 503);
    assert.equal(response.code, 'backend/unavailable');
    assert.equal('stores' in response, false);
  });
});


test('V2 storefront JSON preserves frontend shape and hides drafts for guests', async () => {
  const { app } = fixture({ stores: { async find() { return { storeId: 'legacy-store', ownerId: 'seller', status: 'Active', storeName: 'Books', ownerEmail: 'private', paymentSettings: 'private' }; } },
    products: { async list(id, viewer) { assert.equal(id, 'legacy-store'); assert.equal(viewer, null); return [{ id: 'book', published: true }]; } } });
  await withServer(app, async request => {
    for (const path of ['/api/stores/by-slug/books', '/api/stores/books']) {
      const [status, body] = await request(path);
      assert.equal(status, 200); assert.equal(body.store.ownerEmail, undefined);
      assert.equal(body.store.paymentSettings, undefined); assert.equal(body.products[0].id, 'book');
    }
  });
});

test('V2 product and upload routes reject Buyer and unauthenticated writes', async () => {
  const { app, profiles } = fixture({ allowWrites: true });
  profiles.set('buyer', { role: 'buyer', onboardingCompleted: true });
  await withServer(app, async request => {
    for (const path of ['/api/stores/update', '/api/products/upsert', '/api/products/delete', '/api/uploads/product', '/api/uploads/cover']) {
      assert.equal((await request(path, undefined, {}))[0], 401);
      assert.equal((await request(path, 'buyer', {}))[0], 403);
    }
  });
});

test('V2 product aliases return the backend-acknowledged listing contract', async () => {
  let writes = 0;
  const { app, profiles } = fixture({ allowWrites: true, products: { async save(p, body) { assert.equal(p.uid, 'seller'); writes++; return { id: body.id, published: false }; } } });
  profiles.set('seller', { role: 'seller', onboardingCompleted: true });
  await withServer(app, async request => {
    for (const path of ['/api/products', '/api/products/save', '/api/products/upsert']) {
      const [status, body] = await request(path, 'seller', { id: 'book', published: false });
      assert.equal(status, 200); assert.deepEqual(body, { ok: true, product: { id: 'book', published: false } });
    }
  });
  assert.equal(writes, 3);
});

test('V2 writes remain blocked outside isolated staging even for a valid Seller', async () => {
  const { app, profiles } = fixture();
  profiles.set('seller', { role: 'seller', onboardingCompleted: true });
  await withServer(app, async request => {
    for (const path of ['/api/stores/update', '/api/products/upsert', '/api/products/delete', '/api/uploads/product']) assert.equal((await request(path, 'seller', {}))[0], 503);
    assert.equal((await request('/api/stores/visit', undefined, { storeSlug: 'books' }))[0], 503);
  });
});
