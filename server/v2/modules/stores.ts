import { createHash } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { ApiError } from '../errors.ts';
import type { Principal, StoreCreateResult, StoreRepository } from '../contracts.ts';
import { canonicalStoreId } from './users.ts';
import { FIRST_CREATORS_ID, FIRST_CREATORS_LIMIT } from './creators.ts';
import { assertOwnedActive, requireId, safeImage, validId } from './policy.ts';

export const STORE_SLUG_REGEX = /^[a-z0-9_.-]{2,40}$/;
export const RESERVED_STORE_SLUGS = new Set(['admin', 'superadmin', 'api', 'login', 'checkout', 'support', 'dashboard', 'settings', 'check-slug', 'by-slug']);
export const isValidStoreSlug = (slug: string): boolean => STORE_SLUG_REGEX.test(slug) && !RESERVED_STORE_SLUGS.has(slug);
const currencies = new Set(['PKR', 'INR', 'USD', 'GBP', 'EUR', 'AED', 'SAR', 'CAD', 'AUD']);
const proThemes = new Set(['peach-petal', 'rose-garden', 'midnight-muse', 'midnight-fairy', 'clean-canvas', 'minimal-muse']);
const textFields: Record<string, number> = { storeName: 100, ownerName: 100, country: 80, sellerCountry: 80,
  productType: 100, instagramHandle: 100, announcementText: 240, heroHeadingLine1: 120,
  heroHeadingLine2: 120, heroSubheading: 500, heroButtonText: 60, theme: 80, customAccentColor: 20 };
const publicFields = [...Object.keys(textFields), 'ownerId', 'storeSlug', 'currency', 'plan', 'status', 'heroImage', 'logoUrl', 'ownerAvatar'];
export function publicStoreProjection(id: string, source: Record<string, unknown>) {
  const result: Record<string, unknown> = { storeId: id };
  for (const key of publicFields) if (typeof source[key] === 'string') result[key] = source[key];
  if (typeof source.exchangeRatePkr === 'number' && Number.isFinite(source.exchangeRatePkr)) result.exchangeRatePkr = source.exchangeRatePkr;
  return result;
}
function editable(input: Record<string, unknown>, old: Record<string, any>) {
  const patch: Record<string, any> = {};
  for (const [name, max] of Object.entries(textFields)) {
    if (!Object.hasOwn(input, name)) continue;
    if (typeof input[name] !== 'string' || (input[name] as string).length > max) throw new ApiError(422, 'store/invalid-field', `Invalid ${name}.`);
    patch[name] = (input[name] as string).trim();
  }
  if (Object.hasOwn(input, 'storeSlug')) {
    const slug = typeof input.storeSlug === 'string' ? input.storeSlug.trim().toLowerCase() : '';
    if (!isValidStoreSlug(slug)) throw new ApiError(422, 'store/invalid-slug', 'Choose a valid non-reserved store URL.');
    patch.storeSlug = slug;
  }
  if (Object.hasOwn(input, 'currency')) {
    if (!currencies.has(String(input.currency))) throw new ApiError(422, 'store/invalid-currency', 'Unsupported currency.');
    patch.currency = input.currency;
  }
  if (Object.hasOwn(input, 'exchangeRatePkr')) {
    const rate = input.exchangeRatePkr;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 1 || rate > 10000) throw new ApiError(422, 'store/invalid-rate', 'Exchange rate must be between 1 and 10000.');
    patch.exchangeRatePkr = rate;
  }
  for (const key of ['heroImage', 'logoUrl', 'ownerAvatar']) if (Object.hasOwn(input, key)) patch[key] = safeImage(input[key]);
  if (patch.storeName === '') throw new ApiError(422, 'store/name-required', 'Store name is required.');
  if (patch.theme && patch.theme !== old.theme && proThemes.has(patch.theme) && old.plan !== 'Pro') throw new ApiError(403, 'store/pro-required', 'This theme requires Pro.');
  return patch;
}

export function createFirestoreStoreRepository(db: Firestore): StoreRepository {
  const stores = db.collection('stores');
  const slugs = db.collection('store_slugs');
  const campaign = db.collection('creator_launch_campaigns').doc(FIRST_CREATORS_ID);
  const fromSnap = (snap: any) => snap.exists ? { ...snap.data(), storeId: snap.id } : null;
  return {
    async listPublic() {
      const result = await stores.where('status', '==', 'Active').limit(100).get();
      return result.docs.map(snap => publicStoreProjection(snap.id, snap.data() || {}));
    },
    async find(target) {
      if (!target || target.length > 128) throw new ApiError(422, 'store/invalid-target', 'Invalid store.');
      if (validId(target)) {
        const exact = await stores.doc(target).get();
        if (exact.exists) return fromSnap(exact);
      }
      const slug = target.toLowerCase();
      if (!isValidStoreSlug(slug)) return null;
      const matches = await stores.where('storeSlug', '==', slug).limit(2).get();
      if (matches.docs.length > 1) throw new ApiError(503, 'store/ambiguous-slug', 'Store URL requires administrator repair.');
      return matches.docs.length ? fromSnap(matches.docs[0]) : null;
    },
    async checkSlug(slug, viewer, excludeStoreId) {
      if (!isValidStoreSlug(slug)) return false;
      let ownId = '';
      if (viewer && validId(excludeStoreId)) {
        const owned = await stores.doc(excludeStoreId).get();
        if (owned.exists && owned.get('ownerId') === viewer.uid) ownId = excludeStoreId;
      }
      const [reservation, matches] = await Promise.all([slugs.doc(slug).get(), stores.where('storeSlug', '==', slug).get()]);
      return !(reservation.exists && reservation.get('storeId') !== ownId) && !matches.docs.some(snap => snap.id !== ownId);
    },
    async create(principal, input): Promise<StoreCreateResult> {
      if (!principal.emailVerified) throw new ApiError(403, 'auth/email-not-verified', 'Verify your email first.');
      if (input.ownerId != null && input.ownerId !== principal.uid || input.sellerId != null && input.sellerId !== principal.uid) throw new ApiError(403, 'store/owner-forbidden', 'Cannot create another seller account.');
      const requested = input.storeId == null ? '' : requireId(input.storeId, 'store ID');
      const claimRef = db.collection('creator_launch_claims').doc(principal.uid);
      return db.runTransaction(async (tx: Transaction) => {
        // UID-keyed claim + owner query serialize competing full/truncated-ID requests.
        const claim = await tx.get(claimRef);
        const owned = await tx.get(stores.where('ownerId', '==', principal.uid).limit(2));
        if (owned.docs.length > 1) throw new ApiError(409, 'store/multiple-owned', 'Multiple legacy stores require administrator review.');
        const existing = owned.docs[0];
        if (existing) {
          assertOwnedActive(existing.data(), principal);
          if (requested && requested !== existing.id) throw new ApiError(409, 'store/already-exists', 'Use your existing store.');
          // Creation retries never overwrite later edits or claim another spot.
          return { store: publicStoreProjection(existing.id, existing.data()), existed: true, creatorClaimNumber: claim.exists ? Number(claim.get('claimNumber')) : null };
        }
        const targetId = requested || canonicalStoreId(principal.uid);
        if (targetId !== canonicalStoreId(principal.uid) && targetId !== 'store-' + principal.uid) throw new ApiError(403, 'store/owner-forbidden', 'Invalid new store identifier.');
        requireId(targetId, 'store ID');
        const patch = editable(input, {});
        if (!patch.storeName || !patch.storeSlug) throw new ApiError(400, 'store/required-fields', 'Store name and URL are required.');
        const storeRef = stores.doc(targetId);
        const reservationRef = slugs.doc(patch.storeSlug);
        const old = await tx.get(storeRef);
        const reservation = await tx.get(reservationRef);
        const matching = await tx.get(stores.where('storeSlug', '==', patch.storeSlug));
        const campaignSnap = await tx.get(campaign);
        if (old.exists) throw new ApiError(409, 'store/id-collision', 'Store identifier already exists.');
        if (claim.exists) throw new ApiError(409, 'creator-already-claimed', 'This creator already claimed a store.');
        if (reservation.exists || matching.docs.length) throw new ApiError(409, 'store/slug-taken', 'Store URL already taken.');
        const count = campaignSnap.exists ? Number(campaignSnap.get('claimedCount')) : 0;
        if (!Number.isSafeInteger(count) || count < 0 || count > FIRST_CREATORS_LIMIT) throw new ApiError(503, 'campaign/counter-invalid', 'Creator availability cannot be verified.');
        if (count === FIRST_CREATORS_LIMIT) throw new ApiError(409, 'creator-spots-full', 'All free creator spots are claimed.');
        const now = new Date();
        const doc = { ...patch, ownerId: principal.uid, currency: patch.currency || 'PKR', plan: 'Free', status: 'Active', createdAt: now, updatedAt: now };
        tx.create(storeRef, doc);
        tx.create(reservationRef, { storeId: targetId, ownerId: principal.uid, createdAt: now });
        tx.create(claimRef, { ownerId: principal.uid, storeId: targetId, claimNumber: count + 1, claimedAt: now });
        tx.set(campaign, { limit: 100, claimedCount: count + 1, updatedAt: now }, { merge: true });
        return { store: publicStoreProjection(targetId, doc), existed: false, creatorClaimNumber: count + 1 };
      });
    },
    async update(principal, id, input) {
      requireId(id, 'store ID');
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(422, 'store/invalid-update', 'Invalid store updates.');
      if (['ownerId', 'sellerId', 'status', 'plan', 'storeId'].some(key => Object.hasOwn(input, key))) throw new ApiError(403, 'store/protected-field', 'Ownership, status and plan are administrator controlled.');
      return db.runTransaction(async tx => {
        const ref = stores.doc(id);
        const snap = await tx.get(ref);
        assertOwnedActive(snap.exists ? snap.data() : undefined, principal);
        const old = snap.data()!;
        const patch = editable(input, old);
        const nextSlug = patch.storeSlug || old.storeSlug;
        const newRef = slugs.doc(nextSlug);
        const reservation = await tx.get(newRef);
        const matches = await tx.get(stores.where('storeSlug', '==', nextSlug));
        const oldRef = old.storeSlug && old.storeSlug !== nextSlug ? slugs.doc(old.storeSlug) : null;
        const oldReservation = oldRef ? await tx.get(oldRef) : null;
        if (reservation.exists && reservation.get('storeId') !== id || matches.docs.some(d => d.id !== id)) throw new ApiError(409, 'store/slug-taken', 'Store URL already taken.');
        tx.update(ref, { ...patch, updatedAt: new Date() });
        if (!reservation.exists) tx.create(newRef, { storeId: id, ownerId: principal.uid, createdAt: new Date() });
        if (oldRef && oldReservation?.exists && oldReservation.get('storeId') === id) tx.delete(oldRef);
        return publicStoreProjection(id, { ...old, ...patch });
      });
    },
    async visit(target, checkout, visitorKey) {
      const store = await this.find(target);
      if (!store || store.status !== 'Active') throw new ApiError(404, 'store/not-found', 'Public store not found.');
      // Best-effort abuse bound: one counter event/IP/store/15min. No raw IP stored.
      const key = createHash('sha256').update(store.storeId + ':' + visitorKey + ':' + Math.floor(Date.now() / 900000) + ':' + checkout).digest('hex');
      const marker = db.collection('store_visit_events').doc(key);
      const ref = stores.doc(store.storeId);
      await db.runTransaction(async tx => {
        const fresh = await tx.get(ref);
        const seen = await tx.get(marker);
        if (!fresh.exists || fresh.get('status') !== 'Active') throw new ApiError(404, 'store/not-found', 'Public store not found.');
        if (seen.exists) return;
        const field = checkout ? 'checkoutViewsCount' : 'visitsCount';
        const current = Number(fresh.get(field) || 0);
        if (!Number.isSafeInteger(current) || current < 0) throw new ApiError(503, 'store/invalid-stats', 'Store analytics unavailable.');
        tx.update(ref, { [field]: current + 1 });
        tx.create(marker, { storeId: store.storeId, createdAt: new Date(), expiresAt: new Date(Date.now() + 86400000) });
      });
    },
  };
}
