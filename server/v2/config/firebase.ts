import { assertIsolatedV2Environment } from './staging.ts';
import { parseCloudStagingConfiguration, verifyCloudStagingRuntime } from './cloud-staging.ts';
import fs from 'node:fs';
import path from 'node:path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { parseRenderStagingConfig } from './render-staging.ts';
import { parseProductionV2Configuration } from './production.ts';
import { createSupabaseStorageBucket } from '../storage/supabase.ts';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { safeBackendCategory } from '../errors.ts';
import { createFirebaseVerifier } from '../modules/auth.ts';
import { createFirestoreProfileRepository } from '../modules/users.ts';
import { createCreatorCampaignRepository } from '../modules/creators.ts';
import { createFirestoreStoreRepository } from '../modules/stores.ts';
import { createFirestoreProductRepository } from '../modules/products.ts';
import { createFirebaseUploadRepository, cleanupExpiredUploads } from '../modules/uploads.ts';
import { createCoverReader } from '../storage/covers.ts';
import { selectCloudStagingStorage } from '../storage/providers.ts';
import { createFirestoreFinancialRepository } from '../modules/finance-repository.ts';
import { createFirestoreAdminManagementRepository } from '../modules/admin-management.ts';
import { createGeminiService } from '../modules/assistant.ts';
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
    covers: createCoverReader(storage.bucket(config.storageBucket)),
    readiness,
    ...(process.env.DREAMSTORE_V2_GEMINI_ENABLED === 'true' && process.env.GEMINI_API_KEY?.trim()
      ? { assistant: createGeminiService(process.env.GEMINI_API_KEY.trim()), assistantEnabled: true } : {}),
    adminUid: String(process.env.SUPER_ADMIN_UID || '').trim(),
    // No production write until separate staging verification and owner approval.
    allowUnsignedEmulatorTokens: true,
    allowWrites: true, // All three loopback emulators + demo project validated above.
    paidCheckoutEnabled: process.env.DREAMSTORE_PAID_CHECKOUT_ENABLED === 'true' && process.env.NODE_ENV !== 'production',
    downloadTokenSecret: String(process.env.SERVER_SIGNING_SECRET || process.env.DOWNLOAD_SIGNING_SECRET || process.env.TOKEN_SIGNING_SECRET || ''),
  };
}

/** Separate Cloud Run mode. It never initializes the production Firebase project. */
export async function createCloudStagingV2Dependencies(): Promise<V2Dependencies> {
  const production = readConfig(); // Public identifiers are used only as explicit denylist values.
  const config = parseCloudStagingConfiguration(process.env, production);
  const runtime = await verifyCloudStagingRuntime(config);
  const existing = getApps().find(app => app.name === 'dreamstore-v2-cloud-staging');
  if (existing && existing.options.projectId !== config.projectId) {
    throw new Error('Firebase Admin project mismatch; refusing to serve cloud staging.');
  }
  const app = existing || initializeApp({ projectId: config.projectId, storageBucket: config.storageBucket }, 'dreamstore-v2-cloud-staging');
  const auth = getAuth(app);
  const db = getFirestore(app, config.databaseId);
  db.settings({ preferRest: true, ignoreUndefinedProperties: true });
  // Firebase Storage is never initialized or probed when Supabase is selected.
  const selectedStorage = selectCloudStagingStorage(config, runtime, () => getStorage(app).bucket(config.storageBucket!));
  const { bucket } = selectedStorage;
  const management = createFirestoreAdminManagementRepository(db);
  const readiness: ReadinessService = (() => {
    let lastResult: { time: number; ready: boolean } | null = null;
    let lastWarningAt = 0;
    return {
      async check() {
        const now = Date.now();
        if (lastResult && now - lastResult.time < 10000) return lastResult.ready;
        try {
          await Promise.all([
            selectedStorage.checkReady(), auth.listUsers(1), db.collection('ledger').limit(1).get(),
          ]);
          lastResult = { time: Date.now(), ready: true };
          return true;
        } catch (error) {
          if (now - lastWarningAt > 60000) {
            console.warn('[DreamStore V2 Ready] cloud staging dependency failed', { code: safeBackendCategory(error) });
            lastWarningAt = now;
          }
          lastResult = { time: Date.now(), ready: false };
          return false;
        }
      },
    };
  })();
  // Startup probes fail closed before the service can accept requests.
  if (!await readiness.check()) throw new Error('Cloud staging Firebase Auth, named Firestore, or Storage readiness check failed.');
  return {
    auth: createFirebaseVerifier(auth),
    profiles: createFirestoreProfileRepository(db),
    creators: createCreatorCampaignRepository(db),
    stores: createFirestoreStoreRepository(db),
    products: createFirestoreProductRepository(db, bucket),
    finance: createFirestoreFinancialRepository(db, bucket, runtime.signingSecret),
    management,
    subscriptions: management,
    uploads: createFirebaseUploadRepository(db, bucket),
    covers: createCoverReader(bucket),
    cleanupUploads: () => cleanupExpiredUploads(db, bucket),
    readiness,
    adminUid: config.adminUid,
    allowUnsignedEmulatorTokens: false,
    allowWrites: true,
    paidCheckoutEnabled: false,
    downloadTokenSecret: runtime.signingSecret,
  };
}

/** Render Free uses a separate, owner-approved staging-only credential secret file.
 * Never invoke Cloud Run metadata or production service credentials here.
 */
export async function createRenderStagingV2Dependencies(): Promise<{
  deps: V2Dependencies; gate: { origin: string; signingSecret: string; testerPassword: string };
}> {
  const production = readConfig();
  const serviceFile = fs.readFileSync('/etc/secrets/dreamstore-v2-staging-firebase.json', 'utf8');
  const config = parseRenderStagingConfig(process.env, serviceFile);
  if (config.projectId === production.projectId || config.databaseId === production.firestoreDatabaseId) {
    throw new Error('Render staging refuses production Firebase resources.');
  }
  const existing = getApps().find(app => app.name === 'dreamstore-v2-render-staging');
  if (existing && existing.options.projectId !== config.projectId) {
    throw new Error('Firebase Admin project mismatch.');
  }
  const app = existing || initializeApp({
    projectId: config.projectId, credential: cert(config.serviceAccount),
  }, 'dreamstore-v2-render-staging');
  const auth = getAuth(app);
  const db = getFirestore(app, config.databaseId);
  db.settings({ preferRest: true, ignoreUndefinedProperties: true });
  const bucket = createSupabaseStorageBucket(config.supabase, config.runtime.supabaseSecretKey);
  const management = createFirestoreAdminManagementRepository(db);
  const readiness: ReadinessService = (() => {
    let checked: { time: number; ready: boolean } | null = null;
    return { async check() {
      const now = Date.now();
      if (checked && now - checked.time < 10000) return checked.ready;
      try {
        await Promise.all([auth.listUsers(1), db.collection('ledger').limit(1).get(), bucket.checkReady()]);
        checked = { time: Date.now(), ready: true };
      } catch (error) {
        console.warn('[DreamStore V2 Ready] render staging dependency failed', { code: safeBackendCategory(error) });
        checked = { time: Date.now(), ready: false };
      }
      return checked.ready;
    } };
  })();
  if (!await readiness.check()) throw new Error('Render staging dependencies unavailable.');
  return {
    deps: {
      auth: createFirebaseVerifier(auth),
      profiles: createFirestoreProfileRepository(db),
      creators: createCreatorCampaignRepository(db),
      stores: createFirestoreStoreRepository(db),
      products: createFirestoreProductRepository(db, bucket),
      finance: createFirestoreFinancialRepository(db, bucket, config.runtime.signingSecret),
      management,
      subscriptions: management,
      uploads: createFirebaseUploadRepository(db, bucket),
      covers: createCoverReader(bucket),
      cleanupUploads: () => cleanupExpiredUploads(db, bucket),
      readiness,
      adminUid: config.adminUid,
      allowUnsignedEmulatorTokens: false,
      allowWrites: true,
      paidCheckoutEnabled: false,
      downloadTokenSecret: config.runtime.signingSecret,
    },
    gate: {
      origin: config.origin, signingSecret: config.runtime.signingSecret,
      testerPassword: config.runtime.testerPassword,
    },
  };
}

/** Independent production bootstrap. It cannot reuse staging credentials,
 * emulator tokens, or staging resources. Nothing selects this factory by default.
 */
export async function createLiveProductionV2Dependencies(): Promise<V2Dependencies> {
  const config = parseProductionV2Configuration(process.env, readConfig(),
    fs.readFileSync('/etc/secrets/dreamstore-v2-production-firebase.json', 'utf8'));
  // A fresh named app prevents an earlier initialization from supplying a
  // different credential while retaining the same project ID.
  if (getApps().some(app => app.name === 'dreamstore-v2-production')) {
    throw new Error('Production V2 dependencies are already initialized.');
  }
  const app = initializeApp({ projectId: config.projectId, credential: cert(config.serviceAccount) }, 'dreamstore-v2-production');
  const auth = getAuth(app);
  const db = getFirestore(app, config.databaseId);
  db.settings({ preferRest: true, ignoreUndefinedProperties: true });
  const selected = config.storage.provider === 'supabase'
    ? createSupabaseStorageBucket(config.storage, config.storage.secretKey)
    : getStorage(app).bucket(config.storage.bucket);
  const storageReady = async () => {
    if ('checkReady' in selected) return selected.checkReady();
    const [metadata] = await selected.getMetadata();
    // Private download bytes must not also be accessible through public GCS
    // IAM/ACLs. Require enforced public-access prevention and uniform IAM.
    if (metadata.iamConfiguration?.publicAccessPrevention !== 'enforced' ||
        metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true) {
      throw new Error('Production Storage requires enforced private access.');
    }
  };
  let lastCheck: { at: number; ready: boolean } | undefined;
  const readiness: ReadinessService = { async check() {
    if (lastCheck && Date.now() - lastCheck.at < 10000) return lastCheck.ready;
    try {
      await Promise.all([auth.listUsers(1), db.collection('ledger').limit(1).get(), storageReady()]);
      lastCheck = { at: Date.now(), ready: true };
    } catch (error) {
      console.warn('[DreamStore V2 Ready] production dependency failed', { code: safeBackendCategory(error) });
      lastCheck = { at: Date.now(), ready: false };
    }
    return lastCheck.ready;
  } };
  if (!await readiness.check()) throw new Error('Production V2 dependencies unavailable.');
  const management = createFirestoreAdminManagementRepository(db);
  return {
    auth: createFirebaseVerifier(auth),
    profiles: createFirestoreProfileRepository(db),
    creators: createCreatorCampaignRepository(db),
    stores: createFirestoreStoreRepository(db),
    products: createFirestoreProductRepository(db, selected),
    finance: createFirestoreFinancialRepository(db, selected, config.signingSecret),
    management, subscriptions: management,
    uploads: createFirebaseUploadRepository(db, selected), covers: createCoverReader(selected),
    cleanupUploads: () => cleanupExpiredUploads(db, selected), readiness,
    adminUid: config.adminUid, allowUnsignedEmulatorTokens: false,
    allowWrites: process.env.DREAMSTORE_V2_PRODUCTION_WRITES_ENABLED === 'true',
    paidCheckoutEnabled: false, downloadTokenSecret: config.signingSecret,
  };
}
