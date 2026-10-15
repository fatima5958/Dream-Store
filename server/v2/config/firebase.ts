import fs from 'node:fs';
import path from 'node:path';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { ApiError, safeBackendCategory } from '../errors';
import { createFirebaseVerifier } from '../modules/auth';
import { createFirestoreProfileRepository } from '../modules/users';
import { createCreatorCampaignRepository } from '../modules/creators';
import type { ReadinessService, V2Dependencies } from '../contracts';

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
  const config = readConfig();
  const existing = getApps()[0];
  if (existing && existing.options.projectId && existing.options.projectId !== config.projectId) {
    throw new Error('Firebase Admin project mismatch; refusing to serve accounts.');
  }
  const app = existing || initializeApp({
    credential: applicationDefault(),
    projectId: config.projectId,
  });
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

  return {
    auth: createFirebaseVerifier(auth),
    profiles: createFirestoreProfileRepository(db),
    creators: createCreatorCampaignRepository(db),
    readiness,
    adminUid: String(process.env.SUPER_ADMIN_UID || '').trim(),
    // No production write until separate staging verification and owner approval.
    allowWrites: Boolean(process.env.FIRESTORE_EMULATOR_HOST) &&
      process.env.DREAMSTORE_V2_STAGING === '1',
  };
}
