import 'dotenv/config';
import { register } from 'tsx/esm/api';
register();
if (process.env.DREAMSTORE_V2_MODE === 'cloud-staging') {
  // Uses the exact same project, runtime identity, secrets and selected-provider
  // readiness guards as startup. Never falls back to the production bucket.
  const { createCloudStagingV2Dependencies } = await import('../server/v2/config/firebase.ts');
  const dependencies = await createCloudStagingV2Dependencies();
  await dependencies.cleanupUploads();
  console.log('V2 expired upload reconciliation completed.');
} else {
const { assertIsolatedV2Environment } = await import('../server/v2/config/staging.ts');
assertIsolatedV2Environment(process.env);
const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const { getStorage } = await import('firebase-admin/storage');
const { cleanupExpiredUploads } = await import('../server/v2/modules/uploads.ts');
process.env.STORAGE_EMULATOR_HOST = 'http://' + process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const projectId = process.env.DREAMSTORE_V2_PROJECT_ID;
const app = initializeApp({ projectId });
const { default: config } = await import('../firebase-applet-config.json', { with: { type: 'json' } });
await cleanupExpiredUploads(getFirestore(app, config.firestoreDatabaseId), getStorage(app).bucket(projectId + '.appspot.com'));
console.log('V2 expired upload reconciliation completed.');
}
