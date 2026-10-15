import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { AdminManagementRepository, SubscriptionRepository } from '../contracts.ts';
import { ApiError } from '../errors.ts';

const currencies = new Set(['PKR', 'INR', 'USD', 'GBP', 'EUR', 'AED', 'SAR', 'CAD', 'AUD']);

export function createFirestoreAdminManagementRepository(db: Firestore): AdminManagementRepository & SubscriptionRepository {
  return {
    async updateStore(storeId, patch, actorUid, action) {
      const ref = db.collection('stores').doc(storeId);
      return db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const old = snap.data() || {};
        const now = new Date();
        const next = { ...patch, updatedAt: now, adminUpdatedAtIso: now.toISOString(), adminUpdatedByUid: actorUid };
        tx.update(ref, next);
        const auditId = randomUUID();
        tx.create(db.collection('admin_audit').doc(auditId), { auditId, actorUid, action,
          targetType: 'store', targetId: storeId, ownerId: old.ownerId || '',
          before: Object.fromEntries(Object.keys(patch).map(key => [key, old[key] ?? null])),
          after: patch, createdAtIso: now.toISOString() });
        return { ...old, ...next, storeId };
      });
    },
    async grantPro(input) {
      let ids: string[];
      if (input.storeId) {
        const snap = await db.collection('stores').doc(input.storeId).get();
        if (!snap.exists) throw new ApiError(404, 'admin/store-not-found', 'Store not found.');
        const owner = String(snap.get('ownerId') || '');
        if (!owner || (input.sellerId && input.sellerId !== owner)) throw new ApiError(403, 'admin/store-owner-mismatch', 'Seller does not own this store.');
        input.sellerId = owner;
        ids = [snap.id];
      } else {
        if (!input.sellerId) throw new ApiError(400, 'admin/seller-required', 'Seller identity is required.');
        const owned = await db.collection('stores').where('ownerId', '==', input.sellerId).limit(101).get();
        ids = owned.docs.map(doc => doc.id);
      }
      if (!ids.length) throw new ApiError(404, 'admin/store-not-found', 'No stores found for this Seller.');
      if (ids.length > 100) throw new ApiError(409, 'admin/store-limit', 'Too many stores for one atomic entitlement change.');
      const plan = input.grantPro ? 'Pro' : 'Free';
      const now = new Date();
      await db.runTransaction(async tx => {
        const refs = ids.map(id => ({ id, store: db.collection('stores').doc(id), sub: db.collection('subscriptions').doc(`sub-${id}`) }));
        const reads = await Promise.all(refs.flatMap(row => [tx.get(row.store), tx.get(row.sub)]));
        const stores = reads.filter((_, index) => index % 2 === 0);
        if (stores.some(snap => !snap.exists || snap.get('ownerId') !== input.sellerId)) {
          throw new ApiError(409, 'admin/store-owner-changed', 'Store ownership changed; no plan changes were saved.');
        }
        for (let i = 0; i < refs.length; i++) {
          const storeSnap = stores[i];
          const prior = reads[i * 2 + 1];
          const subscription = { subscriptionId: `sub-${refs[i].id}`, storeId: refs[i].id,
            sellerId: input.sellerId, plan, status: 'Active', updatedAt: now,
            ...(prior.exists ? { createdAt: prior.get('createdAt') || now } : { createdAt: now }),
            ...(prior.get('requestedAtIso') ? { requestedAtIso: prior.get('requestedAtIso') } : {}) };
          tx.update(refs[i].store, { plan, updatedAt: now });
          tx.set(refs[i].sub, subscription);
        }
        const auditId = randomUUID();
        tx.create(db.collection('admin_audit').doc(auditId), { auditId, actorUid: input.actorUid,
          action: input.grantPro ? 'PRO_GRANTED' : 'PRO_REVOKED', targetType: 'seller', targetId: input.sellerId,
          storeIds: ids, plan, createdAtIso: now.toISOString() });
      });
      return { sellerId: input.sellerId!, storeIds: ids, plan };
    },
    async entitlement(sellerId) {
      const owned = await db.collection('stores').where('ownerId', '==', sellerId).limit(2).get();
      if (owned.docs.length > 1) throw new ApiError(409, 'subscription/multiple-stores', 'Multiple owned stores require administrator review.');
      if (!owned.docs.length) return null;
      const store = owned.docs[0].data() || {};
      const pro = store.plan === 'Pro';
      return { sellerId, plan: pro ? 'Pro' : 'Free', hasProEntitlement: pro,
        starterThemes: ['blush-bloom', 'lavender-cloud', 'vanilla-studio'],
        proThemes: ['peach-petal', 'midnight-muse', 'clean-canvas'],
        features: { basicBranding: true, productPublishing: true, visualStoreBuilder: pro,
          advancedLayoutCustomization: pro, premiumThemes: pro, advancedAnalytics: pro } };
    },
    async list(sellerId, storeId) {
      let rows: Array<{ id: string; data: () => Record<string, any> | undefined }>;
      if (storeId) {
        const snap = await db.collection('stores').doc(storeId).get();
        rows = snap.exists ? [snap] : [];
      } else {
        let query: any = db.collection('stores').limit(200);
        if (sellerId) query = db.collection('stores').where('ownerId', '==', sellerId).limit(200);
        const snap = await query.get();
        rows = snap.docs;
      }
      const output: Array<Record<string, any>> = [];
      for (const snap of rows) {
        const store = snap.data() || {};
        const owner = String(store.ownerId || '');
        if (sellerId && owner !== sellerId) continue;
        const subscriptionSnap = await db.collection('subscriptions').doc(`sub-${snap.id}`).get();
        output.push(subscriptionSnap.exists ? { ...subscriptionSnap.data(), subscriptionId: `sub-${snap.id}` } : {
          subscriptionId: `sub-${snap.id}`, storeId: snap.id, sellerId: owner,
          plan: store.plan === 'Pro' ? 'Pro' : 'Free', status: 'Active',
        });
      }
      return output;
    },
    async requestWaitlist(sellerId) {
      const owned = await db.collection('stores').where('ownerId', '==', sellerId).limit(2).get();
      if (owned.docs.length !== 1) throw new ApiError(owned.docs.length ? 409 : 403,
        'subscription/store-required', 'One owned store is required to join the Pro waitlist.');
      const storeRef = owned.docs[0].ref;
      const subRef = db.collection('subscriptions').doc(`sub-${owned.docs[0].id}`);
      return db.runTransaction(async tx => {
        const [store, prior] = await Promise.all([tx.get(storeRef), tx.get(subRef)]);
        if (!store.exists || store.get('ownerId') !== sellerId || store.get('status') !== 'Active') {
          throw new ApiError(403, 'subscription/store-inactive', 'An active owned store is required.');
        }
        if (prior.exists && prior.get('status') !== 'Waitlist') {
          throw new ApiError(409, 'subscription/already-active', 'This store already has a subscription record.');
        }
        const now = new Date();
        const item = { subscriptionId: `sub-${store.id}`, storeId: store.id, sellerId,
          plan: 'Free', status: 'Waitlist', requestedAtIso: prior.get('requestedAtIso') || now.toISOString(),
          createdAt: prior.get('createdAt') || now, updatedAt: now };
        tx.set(subRef, item);
        return item;
      });
    },
  };
}

export function validateAdminStorePatch(action: string, body: Record<string, any>): Record<string, unknown> {
  if (action === 'activate') return { status: 'Active', adminControlStatus: 'active', suspendedAtIso: null };
  if (action === 'suspend') return { status: 'Pending', adminControlStatus: 'suspended', suspendedAtIso: new Date().toISOString() };
  if (action === 'pending') return { status: 'Pending', adminControlStatus: 'pending', suspendedAtIso: null };
  if (action !== 'update_store' || !body.updates || typeof body.updates !== 'object' || Array.isArray(body.updates)) {
    throw new ApiError(400, 'admin/unsupported-store-action', 'Unsupported store control action.');
  }
  const updates = body.updates as Record<string, any>;
  if (Object.keys(updates).some(key => !['storeName', 'currency', 'theme'].includes(key))) {
    throw new ApiError(409, 'admin/protected-store-field', 'Only store name, currency and theme can be edited here. Use the dedicated entitlement action for plan changes.');
  }
  const patch: Record<string, unknown> = {};
  if ('storeName' in updates) {
    if (typeof updates.storeName !== 'string' || !updates.storeName.trim() || updates.storeName.trim().length > 100) throw new ApiError(400, 'admin/invalid-store-name', 'Store name must be 1 to 100 characters.');
    patch.storeName = updates.storeName.trim();
  }
  if ('currency' in updates) {
    if (!currencies.has(String(updates.currency))) throw new ApiError(400, 'admin/invalid-currency', 'Unsupported currency.');
    patch.currency = updates.currency;
  }
  if ('theme' in updates) {
    if (typeof updates.theme !== 'string' || !updates.theme.trim() || updates.theme.trim().length > 80) throw new ApiError(400, 'admin/invalid-theme', 'Theme must be 1 to 80 characters.');
    patch.theme = updates.theme.trim();
  }
  if (!Object.keys(patch).length) throw new ApiError(400, 'admin/empty-store-update', 'No supported store changes supplied.');
  return patch;
}
