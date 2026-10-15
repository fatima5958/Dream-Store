const scenario = process.env.DREAMSTORE_TEST_SCENARIO;
const permissionError = () => Object.assign(new Error('PERMISSION_DENIED fixture'), { code: 7 });
const store = { ownerId: 'seller-test', storeSlug: 'test-shop', storeName: 'Test Shop', status: 'Active', plan: 'Free', currency: 'USD' };
const deliverable = { ownerId: 'seller-test', productId: 'product-test', fileDataUrl: 'storage://deliverables/seller-test/product-test/original.pdf' };
function snapshot(path) {
  const data = path.startsWith('stores/') ? store : path.endsWith('/deliverables/main') ? deliverable : undefined;
  return { id: path.split('/').at(-1), exists: Boolean(data), data: () => data, get: key => data?.[key] };
}
function ref(path) {
  return {
    path, doc: id => ref(path + '/' + id), collection: name => ref(path + '/' + name),
    where() { return this; }, limit() { return this; },
    async get() {
      if (scenario === 'permission-denied') throw permissionError();
      return path.split('/').length % 2 ? { docs: [] } : snapshot(path);
    },
    async set() { if (scenario === 'product-write-denied') throw permissionError(); },
    async update() { throw permissionError(); },
  };
}
export function getFirestore() {
  return {
    settings() {}, collection: name => ref(name),
    async runTransaction(callback) {
      return callback({ get: r => r.get(), set: (r, data) => r.set(data), update: (r, data) => r.update(data), create: (r, data) => r.set(data) });
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
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      if (payload.sub === 'revoked-user') throw new Error('auth/id-token-revoked');
      return { ...payload, uid: payload.sub, email: 'seller@example.test', email_verified: true, name: 'Test Seller' };
    },
    async setCustomUserClaims() { throw permissionError(); },
  };
}
