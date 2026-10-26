/** Independent Render Free staging guard. No Cloud Run metadata impersonation. */
import { parseSupabaseStagingConfiguration, validateSupabaseSecret } from './storage.ts';

const PROJECT = 'tidal-axis-511800-n1';
const PROJECT_NUMBER = '1013305229350';
const DATABASE = 'dreamstore-v2-staging';
const BUCKET = 'dreamstore-v2-staging-files';
const SUPABASE_REF = 'loyuifkrcqecjmwrohvw';
const RENDER_NAME = 'DreamStore-V2-Staging';
const ORIGIN = 'https://dreamstore-v2-staging.onrender.com';
const ACCOUNT = 'dreamstore-v2-staging-runtime@' + PROJECT + '.iam.gserviceaccount.com';

function must(env: Record<string, string | undefined>, key: string): string {
  const value = env[key] || '';
  if (!value.trim()) throw new Error('Render staging missing required configuration: ' + key);
  return value;
}
function listed(env: Record<string, string | undefined>, key: string, expected: string) {
  return String(env[key] || '').split(',').map(s => s.trim()).filter(Boolean).includes(expected);
}
export function parseRenderStagingConfig(env: Record<string, string | undefined>, serviceAccountFile: string) {
  // Fail closed, but name only the mismatched setting (never its value or a secret).
  for (const [key, expected] of [
    ['DREAMSTORE_V2_MODE', 'render-staging'],
    ['DREAMSTORE_V2_STAGING', '1'],
    ['RENDER', 'true'],
    ['RENDER_SERVICE_NAME', RENDER_NAME],
    ['RENDER_SERVICE_TYPE', 'web'],
    ['DREAMSTORE_V2_RENDER_ORIGIN', ORIGIN],
  ] as const) {
    if (env[key] !== expected) {
      throw new Error('Render V2 staging runtime mismatch: ' + key);
    }
  }
  if (!listed(env, 'DREAMSTORE_V2_RENDER_ALLOWED_ORIGINS', ORIGIN)) {
    throw new Error('Render V2 staging runtime mismatch: DREAMSTORE_V2_RENDER_ALLOWED_ORIGINS');
  }
  if (env.DREAMSTORE_V2_RENDER_PROJECT_ID !== PROJECT ||
      env.DREAMSTORE_V2_RENDER_PROJECT_NUMBER !== PROJECT_NUMBER ||
      env.DREAMSTORE_V2_RENDER_DATABASE_ID !== DATABASE ||
      !listed(env, 'DREAMSTORE_V2_RENDER_ALLOWED_PROJECT_IDS', PROJECT) ||
      !listed(env, 'DREAMSTORE_V2_RENDER_ALLOWED_PROJECT_NUMBERS', PROJECT_NUMBER) ||
      !listed(env, 'DREAMSTORE_V2_RENDER_ALLOWED_DATABASE_IDS', DATABASE) ||
      env.GOOGLE_CLOUD_PROJECT && env.GOOGLE_CLOUD_PROJECT !== PROJECT ||
      env.GCLOUD_PROJECT && env.GCLOUD_PROJECT !== PROJECT) {
    throw new Error('Render V2 staging Firebase project identity does not match the staging allowlists.');
  }
  for (const key of [
    'GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_CONFIG',
    'FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST','STORAGE_EMULATOR_HOST',
    'SERVER_SIGNING_SECRET','DOWNLOAD_SIGNING_SECRET','TOKEN_SIGNING_SECRET',
    'K_SERVICE','K_REVISION','K_CONFIGURATION',
    'DREAMSTORE_V2_CLOUD_STAGING_STORAGE_BUCKET','DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_STORAGE_BUCKETS',
  ]) if (env[key]) throw new Error('Render V2 staging refuses conflicting configuration: ' + key);
  if (env.DREAMSTORE_PAID_CHECKOUT_ENABLED === 'true' || env.DREAMSTORE_V2_GEMINI_ENABLED === 'true' ||
      env.DREAMSTORE_V2_STORAGE_PROVIDER !== 'supabase' ||
      env.DREAMSTORE_V2_SUPABASE_BUCKET !== BUCKET) {
    throw new Error('Render V2 staging requires private Supabase storage with payments and AI disabled.');
  }
  const supabase = parseSupabaseStagingConfiguration(env);
  if (supabase.projectRef !== SUPABASE_REF || supabase.bucket !== BUCKET) {
    throw new Error('Render staging Supabase project/bucket identity mismatch.');
  }
  const signingSecret = must(env, 'DREAMSTORE_V2_RENDER_SIGNING_SECRET');
  const testerPassword = must(env, 'DREAMSTORE_V2_RENDER_TESTER_PASSWORD');
  const supabaseSecretKey = must(env, 'DREAMSTORE_V2_RENDER_SUPABASE_SECRET_KEY');
  if (signingSecret.length < 40 || testerPassword.length < 24 || signingSecret === testerPassword ||
      /placeholder|change.me|default/i.test(signingSecret) ||
      /placeholder|change.me|default/i.test(testerPassword)) {
    throw new Error('Render staging requires distinct strong tester and signing secrets.');
  }
  validateSupabaseSecret(supabaseSecretKey, supabase.projectRef);
  let json: Record<string, unknown>;
  try { json = JSON.parse(serviceAccountFile) as Record<string, unknown>; }
  catch { throw new Error('Render staging Firebase secret file is invalid.'); }
  if (!json || json.type !== 'service_account' || json.project_id !== PROJECT ||
      json.client_email !== ACCOUNT || typeof json.private_key !== 'string' ||
      !json.private_key.startsWith('-----BEGIN PRIVATE KEY-----') ||
      !json.private_key.trim().endsWith('-----END PRIVATE KEY-----') ||
      json.token_uri !== 'https://oauth2.googleapis.com/token') {
    throw new Error('Render V2 staging refuses an unapproved Firebase service account key.');
  }
  const adminUid = must(env, 'SUPER_ADMIN_UID');
  if (adminUid.length > 128 || /[\s/\\\x00-\x1f]/.test(adminUid)) throw new Error('Invalid staging admin UID.');
  return {
    projectId: PROJECT, projectNumber: PROJECT_NUMBER, databaseId: DATABASE, supabase, adminUid, origin: ORIGIN,
    serviceAccount: { projectId: PROJECT, clientEmail: ACCOUNT, privateKey: json.private_key },
    runtime: { signingSecret, testerPassword, supabaseSecretKey },
  };
}
