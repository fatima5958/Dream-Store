const scenario = process.env.DREAMSTORE_TEST_SCENARIO;
const permissionError = () => Object.assign(new Error('PERMISSION_DENIED fixture'), { code: 7 });
const store = { ownerId: 'seller-test', storeSlug: 'test-shop', storeName: 'Test Shop', status: 'Active', plan: 'Free', currency: 'USD' };
const deliverable = { ownerId: 'seller-test', productId: 'product-test', fileDataUrl: 'storage://deliverables/seller-test/product-test/original.pdf' };

const founderState = new Map([
  ['stores/store-seller-test', store],
  // Seed 98 spots so the test covers the final two and sold-out transition.
  ['creator_launch_campaigns/first-100-creators', { limit: 100, claimedCount: 98 }],
]);
const founderSnapshot = path => {
  const data = founderState.get(path);
  return { id: path.split('/').at(-1), exists: data !== undefined, data: () => data, get: key => data?.[key] };
};

function snapshot(path) {
  const data = path.startsWith('stores/') ? (scenario === 'suspended-store' ? { ...store, status: 'Pending' } : store) : path.endsWith('/deliverables/main') ? deliverable : undefined;
  return { id: path.split('/').at(-1), exists: Boolean(data), data: () => data, get: key => data?.[key] };
}
function ref(path, filters = []) {
  return {
    path, doc: id => ref(path + '/' + id), collection: name => ref(path + '/' + name),
    where(field, op, value) { return ref(path, [...filters, { field, op, value }]); },
    limit() { return this; },
    async get() {
      if (scenario === 'permission-denied') throw permissionError();
      if (scenario === 'founder-campaign') {
        if (path.split('/').length % 2 === 0) return founderSnapshot(path);
        const docs = [...founderState.keys()]
          .filter(key => key.startsWith(path + '/') && key.split('/').length === path.split('/').length + 1)
          .map(key => founderSnapshot(key))
          .filter(doc => filters.every(f => f.op === '==' && doc.get(f.field) === f.value));
        return { docs };
      }
      return path.split('/').length % 2 ? { docs: [] } : snapshot(path);
    },
    async set(data) {
      if (scenario === 'product-write-denied') throw permissionError();
      if (scenario === 'founder-campaign') founderState.set(path, { ...data });
    },
    async update(data) {
      if (scenario !== 'founder-campaign') throw permissionError();
      if (!founderState.has(path)) throw Error('Document missing');
      founderState.set(path, { ...founderState.get(path), ...data });
    },
    async delete() { if (scenario === 'founder-campaign') founderState.delete(path); },
  };
}
export function getFirestore() {
  return {
    settings() {}, collection: name => ref(name),
    async runTransaction(callback) {
      const writes = [];
      const result = await callback({
        get: r => r.get(),
        set: (r, data) => writes.push(() => r.set(data)),
        update: (r, data) => writes.push(() => r.update(data)),
        create: (r, data) => writes.push(async () => {
          if (scenario === 'founder-campaign' && founderState.has(r.path)) throw Error('Already exists');
          await r.set(data);
        }),
        delete: r => writes.push(() => r.delete()),
      });
      for (const write of writes) await write();
      return result;
    },
  };
}
export function getStorage() {
  return { bucket: () => ({
    async getMetadata() { return [{}]; },
    file: () => ({ async getMetadata() {
      if (scenario === 'storage-missing') throw Object.assign(new Error('No such object'), { code: 404 });
      return [{ size: '100', contentType: 'application/pdf' }];
    } }),
  }) };
}
export function getAuth() {
  return {
    async verifyIdToken(token, checkRevoked) {
      if (checkRevoked !== true) throw new Error('Revocation checking is required.');
      if (scenario === 'auth-admin-permission-denied') {
        throw Object.assign(new Error('test-only Firebase Admin permission denied'), { code: 'auth/insufficient-permission' });
      }
      if (scenario === 'auth-admin-network-outage') {
        throw Object.assign(new Error('test-only network outage'), { code: 'app/network-error' });
      }
      if (scenario === 'auth-admin-no-app') {
        throw Object.assign(new Error('test-only no initialized Firebase Admin app'), { code: 'app/no-app' });
      }
      if (scenario === 'auth-admin-invalid-credential') {
        throw Object.assign(new Error('test-only bad Admin credentials'), { code: 'app/invalid-credential' });
      }
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      if (payload.sub === 'revoked-user') throw Object.assign(new Error('test-only revoked token'), { code: 'auth/id-token-revoked' });
      if (payload.sub === 'expired-admin-user') throw Object.assign(new Error('test-only expired token'), { code: 'auth/id-token-expired' });
      return { ...payload, uid: payload.sub, email: 'seller@example.test', email_verified: payload.email_verified !== false, name: 'Test Seller' };
    },
    async setCustomUserClaims() { throw permissionError(); },
  };
}
