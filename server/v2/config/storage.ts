export interface SupabaseStagingConfiguration {
  url: string;
  projectRef: string;
  bucket: string;
  secretName: string;
}

const csv = (value?: string) => String(value || '').split(',').map(v => v.trim()).filter(Boolean);
export function stagingStorageProvider(env: Record<string, string | undefined>): 'firebase' | 'supabase' {
  const provider = env.DREAMSTORE_V2_STORAGE_PROVIDER || 'firebase';
  if (provider !== 'firebase' && provider !== 'supabase') throw new Error('Unknown V2 staging storage provider.');
  return provider;
}

export function parseSupabaseStagingConfiguration(env: Record<string, string | undefined>): SupabaseStagingConfiguration {
  if (env.DREAMSTORE_V2_STAGING !== '1' || env.DREAMSTORE_V2_MODE !== 'cloud-staging' ||
      stagingStorageProvider(env) !== 'supabase') throw new Error('Supabase Storage requires explicit isolated cloud staging.');
  for (const key of ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'DREAMSTORE_V2_SUPABASE_SECRET_KEY']) {
    if (env[key]) throw new Error('Cloud staging Supabase credentials must come from Secret Manager.');
  }
  const rawUrl = env.DREAMSTORE_V2_SUPABASE_URL || '';
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error('Invalid staging Supabase URL.'); }
  const projectRef = url.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1] || '';
  if (!projectRef || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
      url.pathname !== '/' || rawUrl !== url.origin ||
      !csv(env.DREAMSTORE_V2_SUPABASE_ALLOWED_PROJECT_REFS).includes(projectRef)) {
    throw new Error('Supabase requires an exact allowlisted staging project HTTPS origin.');
  }
  const bucket = String(env.DREAMSTORE_V2_SUPABASE_BUCKET || '');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || !bucket.includes('staging') ||
      !csv(env.DREAMSTORE_V2_SUPABASE_ALLOWED_BUCKETS).includes(bucket)) {
    throw new Error('Supabase requires an explicitly allowlisted staging bucket.');
  }
  const secretName = String(env.DREAMSTORE_V2_SUPABASE_SECRET_NAME || '');
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(secretName) || !/staging/i.test(secretName) ||
      !csv(env.DREAMSTORE_V2_SUPABASE_ALLOWED_SECRET_NAMES).includes(secretName) ||
      secretName === env.DREAMSTORE_V2_CLOUD_STAGING_SIGNING_SECRET_NAME) {
    throw new Error('Supabase requires a separate allowlisted staging credential secret.');
  }
  return { url: url.origin, projectRef, bucket, secretName };
}

export function validateSupabaseSecret(key: string, projectRef: string) {
  if (/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(key)) return;
  // Legacy service_role JWTs still work. This is a configuration check, not JWT
  // authentication: Supabase verifies the signature on every SDK request.
  try {
    if (!/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) throw new Error();
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    if (claims.role === 'service_role' && claims.ref === projectRef && Number(claims.exp) * 1000 > Date.now()) return;
  } catch { /* Never include the rejected value or provider metadata in an error. */ }
  throw new Error('A valid server-only staging Supabase credential is required.');
}
