// This module is dependency-free so isolation guards can be tested without ADC.
export function assertIsolatedV2Environment(env: Record<string, string | undefined>) {
  if (env.DREAMSTORE_V2_STAGING !== '1') throw new Error('V2 requires explicit isolated staging.');
  if (!/^demo-[a-z0-9-]+$/.test(env.DREAMSTORE_V2_PROJECT_ID || '')) throw new Error('V2 writes require a demo-* project ID.');
  for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) {
    if (!/^(127\.0\.0\.1|localhost):[1-9][0-9]{1,4}$/.test(env[name] || '')) throw new Error(`${name} must point to a loopback emulator.`);
  }
  if (env.STORAGE_EMULATOR_HOST && env.STORAGE_EMULATOR_HOST !== 'http://' + env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error('Storage emulator host mismatch.');
}
