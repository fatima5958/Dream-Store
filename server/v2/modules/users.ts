import type { Firestore } from 'firebase-admin/firestore';
import { ApiError } from '../errors';
import type { AccountRole, Principal, ProfileRepository, Role, UserProfile } from '../contracts';

const stamp = (value: any): string =>
  value?.toDate?.()?.toISOString?.() ||
  (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null) ||
  new Date().toISOString();

export const canonicalStoreId = (uid: string): string => 'store-' + uid.slice(0, 20);

export function rolePermissions(role: Role) {
  if (role === 'super_admin') return {
    role, navigation: ['Platform Dashboard', 'Dashboard', 'My Store', 'Products', 'Orders', 'Store Design', 'Settings'],
    allowedScreens: ['landing', 'wizard', 'owner-dashboard', 'storefront', 'shop', 'product-detail',
      'visual-editor', 'super-admin', 'checkout', 'mobile-designs'],
    blockedScreens: [] as string[],
  };
  if (role === 'seller') return {
    role, navigation: ['Dashboard', 'My Store', 'Products', 'Orders', 'Store Design', 'Settings'],
    allowedScreens: ['landing', 'wizard', 'owner-dashboard', 'storefront', 'shop', 'product-detail',
      'visual-editor', 'checkout', 'mobile-designs'],
    blockedScreens: ['super-admin'],
  };
  return {
    role, navigation: ['Storefronts', 'Cart', 'Orders', 'Downloads', 'Profile'],
    allowedScreens: ['landing', 'storefront', 'shop', 'product-detail', 'checkout'],
    blockedScreens: ['wizard', 'owner-dashboard', 'visual-editor', 'super-admin'],
  };
}

function hydrated(principal: Principal, fields: Record<string, any>, role: AccountRole): UserProfile {
  const now = new Date().toISOString();
  return {
    uid: principal.uid,
    role,
    displayName: String(fields.displayName || principal.displayName || 'Creator').slice(0, 120),
    email: principal.email.slice(0, 254),
    onboardingCompleted: fields.onboardingCompleted === true,
    ...(role === 'seller' ? { storeId: String(fields.storeId || canonicalStoreId(principal.uid)) } : {}),
    createdAtIso: fields.createdAtIso || (fields.createdAt ? stamp(fields.createdAt) : now),
    updatedAtIso: fields.updatedAtIso || (fields.updatedAt ? stamp(fields.updatedAt) : now),
  };
}

export function createFirestoreProfileRepository(db: Firestore): ProfileRepository {
  return {
    async find(principal) {
      const snap = await db.collection('users').doc(principal.uid).get();
      if (snap.exists) {
        const fields = snap.data() || {};
        if (fields.role === 'buyer' || fields.role === 'seller') {
          return hydrated(principal, fields, fields.role);
        }
        if (fields.role === 'super_admin') {
          // Admin role comes only from the verified Firebase claim + server UID,
          // never from a freely edited Firestore user document.
          return null;
        }
      }

      // Compatibility with pre-profile Seller accounts: an existing store
      // is enough to restore seller navigation ONLY if ownership is verified.
      const storeId = canonicalStoreId(principal.uid);
      const storeSnap = await db.collection('stores').doc(storeId).get();
      if (storeSnap.exists && storeSnap.get('ownerId') === principal.uid) {
        return hydrated(principal, {
          displayName: storeSnap.get('ownerName') || principal.displayName,
          storeId, onboardingCompleted: true,
          createdAt: storeSnap.get('createdAt'), updatedAt: storeSnap.get('updatedAt'),
        }, 'seller');
      }
      return null;
    },

    async save(principal, role, displayName) {
      if (!principal.emailVerified) throw new ApiError(403, 'auth/email-not-verified', 'Verify your email first.');
      if (!principal.email.includes('@')) throw new ApiError(400, 'auth/email-required', 'A verified email is required.');
      const cleanName = displayName.trim().slice(0, 120);
      if (!cleanName) throw new ApiError(400, 'profile/name-required', 'Please enter your name.');
      const ref = db.collection('users').doc(principal.uid);
      const storeRef = db.collection('stores').doc(canonicalStoreId(principal.uid));

      return db.runTransaction(async tx => {
        const old = await tx.get(ref);
        const oldFields = old.data() || {};
        // Any existing Admin record must be handled only by administrator
        // tooling, not public Buyer/Seller onboarding.
        if (oldFields.role === 'super_admin') {
          throw new ApiError(403, 'auth/role-forbidden', 'This account cannot change its privileged role.');
        }
        // Never silently downgrade an account with a real existing store.
        const store = await tx.get(storeRef);
        if (store.exists && store.get('ownerId') === principal.uid && role !== 'seller') {
          throw new ApiError(409, 'profile/store-owner-role', 'This account already owns a store.');
        }
        const now = new Date();
        tx.set(ref, {
          uid: principal.uid, role, displayName: cleanName, email: principal.email,
          onboardingCompleted: true,
          ...(role === 'seller' ? { storeId: canonicalStoreId(principal.uid) } : {}),
          createdAt: old.exists ? old.get('createdAt') || now : now,
          updatedAt: now,
        });
        return hydrated(principal, {
          role, displayName: cleanName, onboardingCompleted: true,
          createdAt: old.get('createdAt') || now, updatedAt: now,
          ...(role === 'seller' ? { storeId: canonicalStoreId(principal.uid) } : {}),
        }, role);
      });
    },
  };
}
