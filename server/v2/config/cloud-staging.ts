/** Cloud Run staging guard. Emulator guards in staging.ts remain intentionally separate. */
export const PRODUCTION_FIREBASE_PROJECT_ID = 'dulcet-trees-qk6n5';

export interface CloudStagingConfiguration {
  projectId: string;
  databaseId: string;
  storageBucket: string;
  serviceName: string;
  allowedServiceAccounts: string[];
  signingSecretName: string;
  adminUid: string;
}

function csv(env: Record<string, string | undefined>, key: string): string[] {
  return String(env[key] || '').split(',').map(value => value.trim()).filter(Boolean);
}

function required(env: Record<string, string | undefined>, key: string): string {
  const value = String(env[key] || '').trim();
  if (!value) throw new Error(`Cloud staging requires ${key}.`);
  return value;
}

export function parseCloudStagingConfiguration(
  env: Record<string, string | undefined>,
  production: { databaseId?: string; storageBucket?: string } = {},
): CloudStagingConfiguration {
  if (env.DREAMSTORE_V2_MODE !== 'cloud-staging' || env.DREAMSTORE_V2_STAGING !== '1') {
    throw new Error('Cloud staging requires explicit DREAMSTORE_V2_MODE=cloud-staging and DREAMSTORE_V2_STAGING=1.');
  }
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'STORAGE_EMULATOR_HOST']) {
    if (env[key]) throw new Error(`Cloud staging refuses emulator variable ${key}.`);
  }
  for (const key of ['SERVER_SIGNING_SECRET', 'DOWNLOAD_SIGNING_SECRET', 'TOKEN_SIGNING_SECRET', 'GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_CONFIG']) {
    if (env[key]) throw new Error(`Cloud staging refuses inline credential variable ${key}; use the runtime identity and Secret Manager.`);
  }
  if (env.DREAMSTORE_PAID_CHECKOUT_ENABLED === 'true' || env.DREAMSTORE_V2_GEMINI_ENABLED === 'true') {
    throw new Error('Cloud staging refuses paid checkout and optional external services.');
  }

  const projectId = required(env, 'DREAMSTORE_V2_CLOUD_STAGING_PROJECT_ID');
  const allowedProjects = csv(env, 'DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_PROJECT_IDS');
  if (projectId === PRODUCTION_FIREBASE_PROJECT_ID || !allowedProjects.includes(projectId) ||
      (env.GOOGLE_CLOUD_PROJECT && env.GOOGLE_CLOUD_PROJECT !== projectId) ||
      (env.GCLOUD_PROJECT && env.GCLOUD_PROJECT !== projectId)) {
    throw new Error('Cloud staging project is not explicitly allowlisted or does not match the Cloud Run project.');
  }
  const databaseId = required(env, 'DREAMSTORE_V2_CLOUD_STAGING_DATABASE_ID');
  const allowedDatabases = csv(env, 'DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_DATABASE_IDS');
  if (databaseId === '(default)' || databaseId === production.databaseId || !allowedDatabases.includes(databaseId)) {
    throw new Error('Cloud staging requires an explicitly allowlisted, non-production named Firestore database.');
  }
  const storageBucket = required(env, 'DREAMSTORE_V2_CLOUD_STAGING_STORAGE_BUCKET');
  const allowedBuckets = csv(env, 'DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_STORAGE_BUCKETS');
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(storageBucket) ||
      storageBucket === production.storageBucket || !allowedBuckets.includes(storageBucket)) {
    throw new Error('Cloud staging Storage bucket is not explicitly allowlisted or matches production.');
  }
  const serviceName = required(env, 'K_SERVICE');
  const allowedServices = csv(env, 'DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_SERVICES');
  if (!allowedServices.includes(serviceName) || !env.K_REVISION || !env.K_CONFIGURATION) {
    throw new Error('Cloud Run service identity is missing or not allowlisted.');
  }
  const allowedServiceAccounts = csv(env, 'DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_SERVICE_ACCOUNTS');
  if (!allowedServiceAccounts.length || allowedServiceAccounts.some(account =>
    !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(account) || !account.endsWith(`@${projectId}.iam.gserviceaccount.com`))) {
    throw new Error('Cloud staging requires an explicit service-account allowlist within the staging project.');
  }
  const signingSecretName = required(env, 'DREAMSTORE_V2_CLOUD_STAGING_SIGNING_SECRET_NAME');
  const allowedSecrets = csv(env, 'DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_SIGNING_SECRET_NAMES');
  if (!/staging/i.test(signingSecretName) || !allowedSecrets.includes(signingSecretName)) {
    throw new Error('Cloud staging signing secret must be a separately allowlisted staging Secret Manager secret.');
  }
  const adminUid = required(env, 'SUPER_ADMIN_UID');
  if (/\s|[\x00-\x1f]/.test(adminUid)) throw new Error('Configured Super Admin identity is invalid.');
  return { projectId, databaseId, storageBucket, serviceName, allowedServiceAccounts, signingSecretName, adminUid };
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
const METADATA_ROOT = 'http://metadata.google.internal/computeMetadata/v1';

async function metadataText(fetcher: FetchLike, path: string): Promise<string> {
  const response = await fetcher(`${METADATA_ROOT}/${path}`, {
    headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error('Cloud Run metadata identity could not be verified.');
  return (await response.text()).trim();
}

/** Validates the actual runtime identity and retrieves only the named staging secret. */
export async function verifyCloudStagingRuntime(
  config: CloudStagingConfiguration,
  fetcher: FetchLike = fetch,
): Promise<{ projectNumber: string; serviceAccount: string; signingSecret: string }> {
  const [projectId, projectNumber, serviceAccount] = await Promise.all([
    metadataText(fetcher, 'project/project-id'),
    metadataText(fetcher, 'project/numeric-project-id'),
    metadataText(fetcher, 'instance/service-accounts/default/email'),
  ]);
  if (projectId !== config.projectId || !/^\d+$/.test(projectNumber) ||
      !config.allowedServiceAccounts.includes(serviceAccount)) {
    throw new Error('Cloud Run runtime project or service account does not match the staging allowlist.');
  }
  const tokenResponse = await fetcher(`${METADATA_ROOT}/instance/service-accounts/default/token`, {
    headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000),
  });
  if (!tokenResponse.ok) throw new Error('Cloud Run staging identity could not access its required services.');
  const tokenBody = await tokenResponse.json() as { access_token?: string };
  if (!tokenBody.access_token) throw new Error('Cloud Run staging identity did not provide an access token.');
  const secretResponse = await fetcher(
    `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/secrets/${encodeURIComponent(config.signingSecretName)}/versions/latest:access`,
    { headers: { Authorization: `Bearer ${tokenBody.access_token}` }, signal: AbortSignal.timeout(5000) },
  );
  if (!secretResponse.ok) throw new Error('Staging Secret Manager access failed; refusing to start.');
  const secretBody = await secretResponse.json() as { payload?: { data?: string } };
  const signingSecret = Buffer.from(String(secretBody.payload?.data || ''), 'base64').toString('utf8');
  if (signingSecret.trim().length < 32 || /default|placeholder|change_me/i.test(signingSecret)) {
    throw new Error('Staging signing secret is missing or invalid.');
  }
  return { projectNumber, serviceAccount, signingSecret };
}
