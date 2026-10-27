import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseProductionV2Configuration } from '../server/v2/config/production.ts';

const identity = { projectId: 'synthetic-production-project', firestoreDatabaseId: 'production-named-db', storageBucket: 'synthetic-production-project.firebasestorage.app' };
const account = JSON.stringify({ type: 'service_account', project_id: identity.projectId,
  client_email: 'runtime@' + identity.projectId + '.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----\n',
  token_uri: 'https://oauth2.googleapis.com/token' });
const env = () => ({ NODE_ENV: 'production', DREAMSTORE_V2_MODE: 'production',
  DREAMSTORE_V2_PRODUCTION_ENABLED: 'true', DREAMSTORE_V2_PRODUCTION_PROJECT_ID: identity.projectId,
  DREAMSTORE_V2_PRODUCTION_DATABASE_ID: identity.firestoreDatabaseId, SUPER_ADMIN_UID: 'synthetic-admin',
  SERVER_SIGNING_SECRET: 'synthetic-production-signing-secret-for-unit-tests-12345',
  DREAMSTORE_V2_STORAGE_PROVIDER: 'firebase', DREAMSTORE_V2_PRODUCTION_STORAGE_BUCKET: identity.storageBucket });

test('production binds the existing frontend Firebase project, named database, credential and private bucket', () => {
  const config = parseProductionV2Configuration(env(), identity, account);
  assert.equal(config.projectId, identity.projectId);
  assert.equal(config.databaseId, identity.firestoreDatabaseId);
  assert.equal(config.serviceAccount.projectId, identity.projectId);
  assert.deepEqual(config.storage, { provider: 'firebase', bucket: identity.storageBucket });
});

test('production refuses mode confusion, emulator credentials, wrong projects and missing durable signing', () => {
  const cases = [
    e => { delete e.DREAMSTORE_V2_PRODUCTION_ENABLED; },
    e => { e.NODE_ENV = 'development'; },
    e => { e.DREAMSTORE_V2_MODE = 'render-staging'; },
    e => { e.DREAMSTORE_V2_STAGING = '1'; },
    e => { e.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'; },
    e => { e.STORAGE_EMULATOR_HOST = 'http://127.0.0.1:9199'; },
    e => { e.DREAMSTORE_V2_RENDER_SIGNING_SECRET = 'staging-secret'; },
    e => { e.DREAMSTORE_V2_CLOUD_STAGING_PROJECT_ID = 'staging-project'; },
    e => { e.DREAMSTORE_V2_PRODUCTION_PROJECT_ID = 'demo-testing'; },
    e => { e.DREAMSTORE_V2_PRODUCTION_DATABASE_ID = '(default)'; },
    e => { e.GOOGLE_CLOUD_PROJECT = 'different-project'; },
    e => { e.SERVER_SIGNING_SECRET = 'short'; },
    e => { e.DOWNLOAD_SIGNING_SECRET = 'different-secret'; },
    e => { e.SUPER_ADMIN_UID = 'invalid/admin'; },
    e => { e.DREAMSTORE_V2_PRODUCTION_STORAGE_BUCKET = 'wrong-bucket'; },
    e => { e.DREAMSTORE_V2_STORAGE_PROVIDER = 'unknown'; },
    e => { e.DREAMSTORE_PAID_CHECKOUT_ENABLED = 'true'; },
  ];
  for (const patch of cases) {
    const candidate = env(); patch(candidate);
    assert.throws(() => parseProductionV2Configuration(candidate, identity, account));
  }
  for (const raw of ['null', '{}', 'invalid-json', account.replaceAll(identity.projectId, 'staging-project')]) {
    assert.throws(() => parseProductionV2Configuration(env(), identity, raw));
  }
});

test('production Supabase is explicit, server-only, and cannot select the staging bucket', () => {
  const ref = 'abcdefghijklmnopqrst';
  const candidate = { ...env(), DREAMSTORE_V2_STORAGE_PROVIDER: 'supabase',
    DREAMSTORE_V2_PRODUCTION_SUPABASE_URL: 'https://' + ref + '.supabase.co',
    DREAMSTORE_V2_PRODUCTION_SUPABASE_PROJECT_REF: ref,
    DREAMSTORE_V2_PRODUCTION_SUPABASE_BUCKET: 'production-private-files',
    DREAMSTORE_V2_PRODUCTION_SUPABASE_SECRET_KEY: 'sb_secret_' + 's'.repeat(40) };
  assert.equal(parseProductionV2Configuration(candidate, identity, account).storage.provider, 'supabase');
  for (const patch of [
    { DREAMSTORE_V2_PRODUCTION_SUPABASE_URL: 'https://evil.example' },
    { DREAMSTORE_V2_PRODUCTION_SUPABASE_URL: 'https://' + ref + '.supabase.co/' },
    { DREAMSTORE_V2_PRODUCTION_SUPABASE_BUCKET: 'dreamstore-v2-staging-files' },
    { DREAMSTORE_V2_PRODUCTION_SUPABASE_SECRET_KEY: 'public-anon-key' },
  ]) assert.throws(() => parseProductionV2Configuration({ ...candidate, ...patch }, identity, account));
});

test('the production entrypoint exits before loading providers unless independently opted in', () => {
  const result = spawnSync(process.execPath, ['scripts/start-backend-v2-production.mjs'], {
    cwd: new URL('..', import.meta.url), env: { PATH: process.env.PATH, NODE_ENV: 'production' }, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires explicit production configuration/);
});
