import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCloudStagingConfiguration,
  verifyCloudStagingRuntime,
} from '../server/v2/config/cloud-staging.ts';

const production = {
  databaseId: 'ai-studio-dreamstore-fac8084d-6f5b-423c-9b66-3ce72d622890',
  storageBucket: 'dulcet-trees-qk6n5.firebasestorage.app',
};
const baseEnv = () => ({
  DREAMSTORE_V2_MODE: 'cloud-staging', DREAMSTORE_V2_STAGING: '1',
  DREAMSTORE_V2_CLOUD_STAGING_PROJECT_ID: 'dreamstore-stage-23',
  DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_PROJECT_IDS: 'dreamstore-stage-23',
  GOOGLE_CLOUD_PROJECT: 'dreamstore-stage-23',
  DREAMSTORE_V2_CLOUD_STAGING_DATABASE_ID: 'dreamstore-stage-data',
  DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_DATABASE_IDS: 'dreamstore-stage-data',
  DREAMSTORE_V2_CLOUD_STAGING_STORAGE_BUCKET: 'dreamstore-stage-23.firebasestorage.app',
  DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_STORAGE_BUCKETS: 'dreamstore-stage-23.firebasestorage.app',
  K_SERVICE: 'dreamstore-v2-stage', K_REVISION: 'dreamstore-v2-stage-00001-abc', K_CONFIGURATION: 'dreamstore-v2-stage',
  DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_SERVICES: 'dreamstore-v2-stage',
  DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_SERVICE_ACCOUNTS: 'dreamstore-v2-runtime@dreamstore-stage-23.iam.gserviceaccount.com',
  DREAMSTORE_V2_CLOUD_STAGING_SIGNING_SECRET_NAME: 'dreamstore-v2-staging-download-signing',
  DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_SIGNING_SECRET_NAMES: 'dreamstore-v2-staging-download-signing',
  SUPER_ADMIN_UID: 'synthetic-admin-uid',
});
const configFor = (env = baseEnv()) => parseCloudStagingConfiguration(env, production);

test('cloud staging accepts only an explicitly allowlisted isolated project and named resources', () => {
  const config = configFor();
  assert.equal(config.projectId, 'dreamstore-stage-23');
  assert.equal(config.databaseId, 'dreamstore-stage-data');
  assert.equal(config.storageBucket, 'dreamstore-stage-23.firebasestorage.app');
});

test('cloud staging refuses missing activation, production project, wrong project and non-named database', () => {
  for (const mutate of [
    env => { env.DREAMSTORE_V2_STAGING = '0'; },
    env => { env.DREAMSTORE_V2_CLOUD_STAGING_PROJECT_ID = 'dulcet-trees-qk6n5'; env.GOOGLE_CLOUD_PROJECT = 'dulcet-trees-qk6n5'; },
    env => { env.GOOGLE_CLOUD_PROJECT = 'another-project'; },
    env => { env.DREAMSTORE_V2_CLOUD_STAGING_DATABASE_ID = '(default)'; },
    env => { env.DREAMSTORE_V2_CLOUD_STAGING_DATABASE_ID = production.databaseId; env.DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_DATABASE_IDS = production.databaseId; },
  ]) {
    const env = baseEnv(); mutate(env);
    assert.throws(() => configFor(env));
  }
});

test('cloud staging refuses non-allowlisted bucket, service, missing runtime identity and wrong production bucket', () => {
  const cases = [
    env => { env.DREAMSTORE_V2_CLOUD_STAGING_STORAGE_BUCKET = 'other-stage-bucket'; },
    env => { env.DREAMSTORE_V2_CLOUD_STAGING_STORAGE_BUCKET = production.storageBucket; env.DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_STORAGE_BUCKETS = production.storageBucket; },
    env => { env.K_SERVICE = 'unapproved-service'; },
    env => { delete env.DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_SERVICE_ACCOUNTS; },
    env => { env.DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_SERVICE_ACCOUNTS = 'runtime@production-project.iam.gserviceaccount.com'; },
  ];
  for (const mutate of cases) {
    const env = baseEnv(); mutate(env);
    assert.throws(() => configFor(env));
  }
});

test('cloud staging refuses emulator, inline secrets, credential files and paid checkout', () => {
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'STORAGE_EMULATOR_HOST', 'SERVER_SIGNING_SECRET', 'DOWNLOAD_SIGNING_SECRET', 'TOKEN_SIGNING_SECRET', 'GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_CONFIG', 'DREAMSTORE_PAID_CHECKOUT_ENABLED']) {
    const env = baseEnv(); env[key] = key === 'DREAMSTORE_PAID_CHECKOUT_ENABLED' ? 'true' : '127.0.0.1:8080';
    assert.throws(() => configFor(env), key);
  }
});

test('cloud staging rejects missing or non-staging Secret Manager configuration', () => {
  for (const value of ['', 'production-signing-key']) {
    const env = baseEnv();
    env.DREAMSTORE_V2_CLOUD_STAGING_SIGNING_SECRET_NAME = value;
    env.DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_SIGNING_SECRET_NAMES = value;
    assert.throws(() => configFor(env));
  }
});

test('runtime verification checks actual Cloud Run project and service identity before reading the staging secret', async () => {
  const config = configFor();
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/project/project-id')) return new Response('dreamstore-stage-23');
    if (String(url).endsWith('/project/numeric-project-id')) return new Response('123456789');
    if (String(url).endsWith('/instance/service-accounts/default/email')) return new Response(config.allowedServiceAccounts[0]);
    if (String(url).endsWith('/instance/service-accounts/default/token')) return Response.json({ access_token: 'synthetic-metadata-token' });
    if (String(url).includes('secretmanager.googleapis.com')) return Response.json({ payload: { data: Buffer.from('synthetic-stage-signing-secret-at-least-32').toString('base64') } });
    throw new Error('Unexpected outbound request');
  };
  const result = await verifyCloudStagingRuntime(config, fetcher);
  assert.equal(result.projectNumber, '123456789');
  assert.equal(result.serviceAccount, config.allowedServiceAccounts[0]);
  assert.equal(result.signingSecret, 'synthetic-stage-signing-secret-at-least-32');
  assert.equal(calls.some(call => call.url.includes('dulcet-trees-qk6n5')), false);
  const secretCall = calls.find(call => call.url.includes('secretmanager.googleapis.com'));
  assert.equal(secretCall.init.headers.Authorization, 'Bearer synthetic-metadata-token');
});

test('runtime verification rejects wrong Cloud Run identity without requesting any secret', async () => {
  const config = configFor();
  let secretRequested = false;
  const fetcher = async url => {
    const path = String(url);
    if (path.endsWith('/project/project-id')) return new Response('dreamstore-stage-23');
    if (path.endsWith('/project/numeric-project-id')) return new Response('123456789');
    if (path.endsWith('/instance/service-accounts/default/email')) return new Response('wrong@other-project.iam.gserviceaccount.com');
    if (path.includes('secretmanager.googleapis.com')) secretRequested = true;
    return Response.json({ access_token: 'token' });
  };
  await assert.rejects(verifyCloudStagingRuntime(config, fetcher), /does not match the staging allowlist/);
  assert.equal(secretRequested, false);
});

test('runtime verification fails closed when metadata, Secret Manager or secret value is unavailable', async () => {
  const config = configFor();
  await assert.rejects(verifyCloudStagingRuntime(config, async () => new Response('', { status: 403 })));
  const fetcher = async url => {
    const path = String(url);
    if (path.endsWith('/project/project-id')) return new Response('dreamstore-stage-23');
    if (path.endsWith('/project/numeric-project-id')) return new Response('123456789');
    if (path.endsWith('/instance/service-accounts/default/email')) return new Response(config.allowedServiceAccounts[0]);
    if (path.endsWith('/instance/service-accounts/default/token')) return Response.json({ access_token: 'token' });
    return Response.json({ payload: { data: Buffer.from('short').toString('base64') } });
  };
  await assert.rejects(verifyCloudStagingRuntime(config, fetcher), /missing or invalid/);
});
