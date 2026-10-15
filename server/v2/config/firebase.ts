import { assertIsolatedV2Environment } from './staging.ts';
import fs from 'node:fs';
import path from 'node:path';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { ApiError, safeBackendCategory } from '../errors.ts';
import { createFirebaseVerifier } from '../modules/auth.ts';
import { createFirestoreProfileRepository } from '../modules/users.ts';
import { createCreatorCampaignRepository } from '../modules/creators.ts';
import { createFirestoreStoreRepository } from '../modules/stores.ts';
import { createFirestoreProductRepository } from '../modules/products.ts';
import { createFirebaseUploadRepository, validateFileBytes } from '../modules/uploads.ts';
import { createFirestoreFinancialRepository } from '../modules/finance-repository.ts';
import { createFirestoreAdminManagementRepository } from '../modules/admin-management.ts';
import type { ReadinessService, V2Dependencies } from '../contracts.ts';

interface PublicFirebaseConfig {
  projectId: string;
  firestoreDatabaseId: string;
  storageBucket: string;
}

function readConfig(): PublicFirebaseConfig {
  const filename = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!data.projectId || !data.firestoreDatabaseId || !data.storageBucket) {
    throw new Error('Missing Firebase project, named database, or Storage bucket configuration.');
  }
  return data;
}

function stableSigningSecretReady(): boolean {
  const secret = String(process.env.SERVER_SIGNING_SECRET || process.env.DOWNLOAD_SIGNING_SECRET ||
    process.env.TOKEN_SIGNING_SECRET || '').trim();
  return secret.length >= 32 && !/default|placeholder|change_me/i.test(secret);
}

export function createProductionV2Dependencies(): V2Dependencies {
  assertIsolatedV2Environment(process.env);
  const original = readConfig();
  const config = { ...original, projectId: process.env.DREAMSTORE_V2_PROJECT_ID!,
    storageBucket: process.env.DREAMSTORE_V2_PROJECT_ID + '.appspot.com' };
  process.env.STORAGE_EMULATOR_HOST = 'http://' + process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  const existing = getApps().find(app => app.name === 'dreamstore-v2-isolated');
  if (existing && existing.options.projectId && existing.options.projectId !== config.projectId) {
    throw new Error('Firebase Admin project mismatch; refusing to serve accounts.');
  }
  const app = existing || initializeApp({
    projectId: config.projectId,
  }, 'dreamstore-v2-isolated');
  const auth = getAuth(app);
  // The existing DreamStore data lives in a NAMED database, not (default).
  const db = getFirestore(app, config.firestoreDatabaseId);
  db.settings({ preferRest: true, ignoreUndefinedProperties: true });
  const storage = getStorage(app);

  const readiness: ReadinessService = (() => {
    let lastResult: { time: number; ready: boolean } | null = null;
    let lastWarningAt = 0;
    return {
      async check() {
        const now = Date.now();
        if (lastResult && now - lastResult.time < 10000) return lastResult.ready;
        if (!stableSigningSecretReady()) {
          if (now - lastWarningAt > 60000) {
            console.warn('[DreamStore V2 Ready] missing durable signing secret');
            lastWarningAt = now;
          }
          lastResult = { time: now, ready: false };
          return false;
        }
        try {
          await Promise.all([
            auth.listUsers(1), // Validate Firebase Auth admin permission.
            db.collection('ledger').limit(1).get(),
            storage.bucket(config.storageBucket).getMetadata(),
          ]);
          lastResult = { time: Date.now(), ready: true };
          return true;
        } catch (error) {
          if (now - lastWarningAt > 60000) {
            console.warn('[DreamStore V2 Ready] dependency failed', { code: safeBackendCategory(error) });
            lastWarningAt = now;
          }
          lastResult = { time: Date.now(), ready: false };
          return false;
        }
      },
    };
  })();
  const management = createFirestoreAdminManagementRepository(db);

  return {
    auth: createFirebaseVerifier(auth),
    profiles: createFirestoreProfileRepository(db),
    creators: createCreatorCampaignRepository(db),
    stores: createFirestoreStoreRepository(db),
    products: createFirestoreProductRepository(db, storage.bucket(config.storageBucket)),
    finance: createFirestoreFinancialRepository(db, storage.bucket(config.storageBucket)),
    management,
    subscriptions: management,
    uploads: createFirebaseUploadRepository(db, storage.bucket(config.storageBucket)),
    covers: {
      async read(ownerId, fileName) {
        try {
          const file = storage.bucket(config.storageBucket).file(`stores/${ownerId}/public/${fileName}`);
          const [meta] = await file.getMetadata();
          if (Number(meta.size) < 1 || Number(meta.size) > 5 * 1024 * 1024) throw new ApiError(404, 'cover/not-found', 'Cover not found.');
          const [data] = await file.download({ validation: 'crc32c' });
          const contentType = String(meta.contentType || '');
          validateFileBytes(fileName, contentType, data, 'cover');
          return { data, contentType };
        } catch { throw new ApiError(404, 'cover/not-found', 'Cover not found.'); }
      },
    },
    readiness,
    adminUid: String(process.env.SUPER_ADMIN_UID || '').trim(),
    // No production write until separate staging verification and owner approval.
    allowUnsignedEmulatorTokens: true,
    allowWrites: true, // All three loopback emulators + demo project validated above.
    paidCheckoutEnabled: process.env.DREAMSTORE_PAID_CHECKOUT_ENABLED === 'true' && process.env.NODE_ENV !== 'production',
    downloadTokenSecret: String(process.env.SERVER_SIGNING_SECRET || process.env.DOWNLOAD_SIGNING_SECRET || process.env.TOKEN_SIGNING_SECRET || ''),
  };
}
