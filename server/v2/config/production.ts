// Production has its own opt-in and resource identity checks. Staging guards
// must never be relaxed to make production start.
import { validateSupabaseSecret } from './storage.ts';

type Environment = Record<string, string | undefined>;
export interface ProductionFirebaseIdentity {
  projectId: string;
  firestoreDatabaseId: string;
  storageBucket: string;
}

const required = (env: Environment, key: string) => {
  const value = String(env[key] || '').trim();
  if (!value) throw new Error('Production missing required configuration: ' + key);
  return value;
};

export function parseProductionV2Configuration(
  env: Environment, identity: ProductionFirebaseIdentity, serviceAccountFile: string,
) {
  if (env.NODE_ENV !== 'production' || env.DREAMSTORE_V2_MODE !== 'production' ||
      env.DREAMSTORE_V2_PRODUCTION_ENABLED !== 'true' || env.DREAMSTORE_V2_STAGING === '1') {
    throw new Error('V2 production requires a separate explicit production opt-in.');
  }
  for (const key of Object.keys(env)) {
    if (env[key] && (key.includes('EMULATOR_HOST') ||
        key.startsWith('DREAMSTORE_V2_RENDER_') || key.startsWith('DREAMSTORE_V2_CLOUD_STAGING_'))) {
      throw new Error('Production refuses staging configuration: ' + key);
    }
  }
  const projectId = required(env, 'DREAMSTORE_V2_PRODUCTION_PROJECT_ID');
  const databaseId = required(env, 'DREAMSTORE_V2_PRODUCTION_DATABASE_ID');
  if (projectId !== identity.projectId || databaseId !== identity.firestoreDatabaseId ||
      /^(demo-|.*staging)/i.test(projectId) || /staging/i.test(databaseId) ||
      env.GOOGLE_CLOUD_PROJECT && env.GOOGLE_CLOUD_PROJECT !== projectId ||
      env.GCLOUD_PROJECT && env.GCLOUD_PROJECT !== projectId) {
    throw new Error('Production Firebase identity does not match the frontend project and named database.');
  }
  const adminUid = required(env, 'SUPER_ADMIN_UID');
  if (adminUid.length > 128 || /[\s/\\\x00-\x1f\x7f]/.test(adminUid)) throw new Error('Invalid production admin UID.');
  const signingSecret = required(env, 'SERVER_SIGNING_SECRET');
  if (signingSecret.length < 40 || /placeholder|change.me|default/i.test(signingSecret)) {
    throw new Error('Production requires a durable strong signing secret.');
  }
  if (['DOWNLOAD_SIGNING_SECRET', 'TOKEN_SIGNING_SECRET'].some(key => env[key] && env[key] !== signingSecret)) {
    throw new Error('Production refuses conflicting download signing secrets.');
  }
  let account: Record<string, unknown>;
  try { account = JSON.parse(serviceAccountFile); }
  catch { throw new Error('Production Firebase credential file is invalid.'); }
  if (!account || account.type !== 'service_account' || account.project_id !== projectId ||
      typeof account.client_email !== 'string' || !account.client_email.endsWith('@' + projectId + '.iam.gserviceaccount.com') ||
      typeof account.private_key !== 'string' || !account.private_key.startsWith('-----BEGIN PRIVATE KEY-----') ||
      !account.private_key.trim().endsWith('-----END PRIVATE KEY-----') ||
      account.token_uri !== 'https://oauth2.googleapis.com/token') {
    throw new Error('Production Firebase credential identity mismatch.');
  }
  const provider = required(env, 'DREAMSTORE_V2_STORAGE_PROVIDER');
  let storage:
    | { provider: 'firebase'; bucket: string }
    | { provider: 'supabase'; bucket: string; url: string; projectRef: string; secretName: string; secretKey: string };
  if (provider === 'firebase') {
    const bucket = required(env, 'DREAMSTORE_V2_PRODUCTION_STORAGE_BUCKET');
    if (bucket !== identity.storageBucket) throw new Error('Production Firebase Storage bucket identity mismatch.');
    storage = { provider, bucket };
  } else if (provider === 'supabase') {
    const rawUrl = required(env, 'DREAMSTORE_V2_PRODUCTION_SUPABASE_URL');
    let url: URL;
    try { url = new URL(rawUrl); } catch { throw new Error('Invalid production Supabase origin.'); }
    const projectRef = required(env, 'DREAMSTORE_V2_PRODUCTION_SUPABASE_PROJECT_REF');
    const bucket = required(env, 'DREAMSTORE_V2_PRODUCTION_SUPABASE_BUCKET');
    if (!/^[a-z0-9]{20}$/.test(projectRef) || rawUrl !== 'https://' + projectRef + '.supabase.co' ||
        url.origin !== rawUrl || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || /staging/i.test(bucket)) {
      throw new Error('Production Supabase resource identity mismatch.');
    }
    const secretKey = required(env, 'DREAMSTORE_V2_PRODUCTION_SUPABASE_SECRET_KEY');
    validateSupabaseSecret(secretKey, projectRef);
    storage = { provider, bucket, url: rawUrl, projectRef, secretName: 'production-runtime', secretKey };
  } else {
    throw new Error('Production requires an explicit supported private storage provider.');
  }
  // Paid production checkout remains a separate change, with end-to-end tests.
  if (env.DREAMSTORE_PAID_CHECKOUT_ENABLED === 'true') throw new Error('Production paid checkout has not been enabled by this bootstrap.');
  return {
    projectId, databaseId, adminUid, signingSecret, storage,
    serviceAccount: { projectId, clientEmail: account.client_email, privateKey: account.private_key },
  };
}
