import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { ApiError } from '../errors';
import type { Principal, StoreCreateResult, StoreRepository } from '../contracts';
import { canonicalStoreId } from './users';
import { FIRST_CREATORS_ID, FIRST_CREATORS_LIMIT } from './creators';

// Matches existing V1 URL rules; never trust a client-supplied store ID or role.
export const STORE_SLUG_REGEX = /^[a-z0-9_.-]{2,40}$/;
export const RESERVED_STORE_SLUGS = new Set([
  'admin', 'superadmin', 'api', 'login', 'checkout', 'support', 'dashboard', 'settings',
]);
export const isValidStoreSlug = (slug: string): boolean =>
  STORE_SLUG_REGEX.test(slug) && !RESERVED_STORE_SLUGS.has(slug);

const currencies = new Set(['PKR', 'INR', 'USD', 'GBP', 'EUR', 'AED', 'SAR', 'CAD', 'AUD']);

function field(value: unknown, max: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, max);
}

function createStoreDocument(
  input: Record<string, unknown>,
  principal: Principal,
  storeId: string,
  slug: string,
  old: Record<string, any>,
  now: Date,
) {
  const name = field(input.storeName, 100);
  const country = field(input.country || input.sellerCountry, 80, 'Pakistan');
  const currency = String(input.currency || 'PKR');
  const rate = Number(input.exchangeRatePkr);
  const stableRate = Number.isFinite(rate) && rate > 0 && rate < 1000000 ? rate : 278;
  return {
    ownerId: principal.uid,
    storeSlug: slug,
    storeName: name,
    ownerName: field(input.ownerName, 100, name),
    instagramHandle: field(input.instagramHandle, 100, '@' + slug),
    sellerCountry: country,
    productType: field(input.productType, 100, 'Ebooks & Guides'),
    announcementText: field(input.announcementText, 240, 'Welcome to ' + name),
    heroHeadingLine1: field(input.heroHeadingLine1, 120, name),
    heroHeadingLine2: field(input.heroHeadingLine2, 120, 'Digital Products'),
    heroSubheading: field(input.heroSubheading, 500, 'Explore our products.'),
    heroButtonText: field(input.heroButtonText, 60, 'Shop Now'),
    heroImage: field(input.heroImage, 8192),
    logoUrl: field(input.logoUrl, 8192),
    theme: field(input.theme, 80, 'blush-rose'),
    customAccentColor: field(input.customAccentColor, 64),
    currency: currencies.has(currency) ? currency : 'PKR',
    exchangeRatePkr: stableRate,
    // Paid entitlements and suspension are NEVER client-authoritative.
    plan: old.plan === 'Pro' ? 'Pro' : 'Free',
    status: typeof old.status === 'string' ? old.status : 'Active',
    createdAt: old.createdAt || now,
    updatedAt: now,
    // Explicitly exclude ownerEmail and private payment settings from public
    // store documents returned to the browser.
  };
}

export function createFirestoreStoreRepository(db: Firestore): StoreRepository {
  const stores = db.collection('stores');
  const slugs = db.collection('store_slugs');
  const campaign = db.collection('creator_launch_campaigns').doc(FIRST_CREATORS_ID);

  return {
    async checkSlug(slug, viewer, excludeStoreId) {
      if (!isValidStoreSlug(slug)) return false;
      let ownId = '';
      if (viewer && excludeStoreId &&
          /^store-[A-Za-z0-9_-]{1,128}$/.test(excludeStoreId)) {
        const owned = await stores.doc(excludeStoreId).get();
        if (owned.exists && owned.get('ownerId') === viewer.uid) ownId = excludeStoreId;
      }
      const [reservation, matches] = await Promise.all([
        slugs.doc(slug).get(),
        stores.where('storeSlug', '==', slug).get(),
      ]);
      return !(reservation.exists && reservation.get('storeId') !== ownId) &&
        !matches.docs.some(snap => snap.id !== ownId);
    },

    async create(principal, input): Promise<StoreCreateResult> {
      const slug = field(input.storeSlug, 256).toLowerCase();
      const name = field(input.storeName, 100);
      if (!name || !slug) {
        throw new ApiError(400, 'store/required-fields', 'Store name and store URL are required.');
      }
      if (!isValidStoreSlug(slug)) {
        throw new ApiError(400, 'store/invalid-slug', 'Choose a valid, non-reserved store URL.');
      }
      if (input.sellerId != null && String(input.sellerId) !== principal.uid) {
        throw new ApiError(403, 'auth/identity-mismatch', 'Cannot create another Seller account.');
      }
      const storeId = canonicalStoreId(principal.uid);
      const fullUidStoreId = 'store-' + principal.uid;
      if (input.storeId != null &&
          String(input.storeId) !== storeId &&
          String(input.storeId) !== fullUidStoreId) {
        throw new ApiError(403, 'store/owner-forbidden', 'You cannot use another store identifier.');
      }
      const targetId = typeof input.storeId === 'string' ? input.storeId : storeId;
      const storeRef = stores.doc(targetId);
      const reservationRef = slugs.doc(slug);
      const claimRef = db.collection('creator_launch_claims').doc(principal.uid);

      return db.runTransaction(async (tx: Transaction) => {
        // All reads before writes, including query-based reservations.
        // Firestore retries conflicting transactions for concurrent claims.
        const oldSnap = await tx.get(storeRef);
        const reservation = await tx.get(reservationRef);
        const matchingStores = await tx.get(stores.where('storeSlug', '==', slug));
        const oldFields = oldSnap.data() || {};
        const previousSlug = String(oldFields.storeSlug || '').toLowerCase();
        const priorReservationRef = previousSlug && previousSlug !== slug ? slugs.doc(previousSlug) : null;
        const priorReservation = priorReservationRef ? await tx.get(priorReservationRef) : null;

        const isFirst = !oldSnap.exists;
        const campaignSnap = isFirst ? await tx.get(campaign) : null;
        const claimSnap = isFirst ? await tx.get(claimRef) : null;

        if (oldSnap.exists && oldFields.ownerId !== principal.uid) {
          throw new ApiError(403, 'store/owner-forbidden', 'This store belongs to another creator.');
        }
        if (oldSnap.exists && oldFields.status !== 'Active') {
          throw new ApiError(403, 'store/suspended', 'Suspended stores cannot be changed.');
        }
        if ((reservation.exists && reservation.get('storeId') !== targetId) ||
            matchingStores.docs.some(doc => doc.id !== targetId)) {
          throw new ApiError(409, 'store/slug-taken', 'This store URL is already taken.');
        }

        let creatorClaimNumber: number | null = null;
        if (isFirst) {
          const claimed = campaignSnap?.exists ? Number(campaignSnap.get('claimedCount')) : 0;
          if (!Number.isSafeInteger(claimed) || claimed < 0 || claimed > FIRST_CREATORS_LIMIT) {
            throw new ApiError(503, 'campaign/counter-invalid', 'Creator spot availability could not be verified.');
          }
          if (claimSnap?.exists) {
            throw new ApiError(409, 'creator-already-claimed', 'This creator already claimed a store.');
          }
          if (claimed >= FIRST_CREATORS_LIMIT) {
            throw new ApiError(409, 'creator-spots-full', 'All 100 free creator spots have been claimed.');
          }
          creatorClaimNumber = claimed + 1;
        }
        const now = new Date();
        const storeDoc = createStoreDocument(input, principal, targetId, slug, oldFields, now);
        tx.set(storeRef, storeDoc);
        if (!reservation.exists) {
          tx.create(reservationRef, { storeId: targetId, ownerId: principal.uid, createdAt: now });
        }
        if (priorReservationRef && priorReservation?.exists &&
            priorReservation.get('storeId') === targetId) {
          tx.delete(priorReservationRef);
        }
        if (creatorClaimNumber !== null) {
          tx.create(claimRef, { ownerId: principal.uid, storeId: targetId,
            claimNumber: creatorClaimNumber, claimedAt: now });
          if (campaignSnap?.exists) {
            tx.update(campaign, { claimedCount: creatorClaimNumber, updatedAt: now });
          } else {
            tx.create(campaign, { limit: FIRST_CREATORS_LIMIT,
              claimedCount: creatorClaimNumber, createdAt: now, updatedAt: now });
          }
        }
        return { store: { storeId: targetId, ownerEmail: principal.email, ...storeDoc },
          existed: oldSnap.exists, creatorClaimNumber };
      });
    },
  };
}
