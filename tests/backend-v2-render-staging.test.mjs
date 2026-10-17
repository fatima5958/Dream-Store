import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { parseRenderStagingConfig } from '../server/v2/config/render-staging.ts';
import { createRenderTesterGate } from '../server/v2/modules/render-tester-gate.ts';

const ref = 'loyuifkrcqecjmwrohvw';
const origin = 'https://dreamstore-v2-staging.onrender.com';
const password = 'synthetic-tester-password-with-entropy-1234';
const signingSecret = 'synthetic-staging-signing-secret-for-tests-not-for-live-123456';
const account = JSON.stringify({
  type: 'service_account',
  project_id: 'tidal-axis-511800-n1',
  client_email: 'dreamstore-v2-staging-runtime@tidal-axis-511800-n1.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----\n',
  token_uri: 'https://oauth2.googleapis.com/token',
});
const env = () => ({
  DREAMSTORE_V2_STAGING: '1', DREAMSTORE_V2_MODE: 'render-staging',
  RENDER: 'true', RENDER_SERVICE_NAME: 'DreamStore-V2-Staging', RENDER_SERVICE_TYPE: 'web',
  DREAMSTORE_V2_RENDER_ORIGIN: origin, DREAMSTORE_V2_RENDER_ALLOWED_ORIGINS: origin,
  DREAMSTORE_V2_RENDER_PROJECT_ID: 'tidal-axis-511800-n1',
  DREAMSTORE_V2_RENDER_ALLOWED_PROJECT_IDS: 'tidal-axis-511800-n1',
  DREAMSTORE_V2_RENDER_PROJECT_NUMBER: '1013305229350',
  DREAMSTORE_V2_RENDER_ALLOWED_PROJECT_NUMBERS: '1013305229350',
  DREAMSTORE_V2_RENDER_DATABASE_ID: 'dreamstore-v2-staging',
  DREAMSTORE_V2_RENDER_ALLOWED_DATABASE_IDS: 'dreamstore-v2-staging',
  DREAMSTORE_V2_STORAGE_PROVIDER: 'supabase',
  DREAMSTORE_V2_SUPABASE_URL: 'https://' + ref + '.supabase.co',
  DREAMSTORE_V2_SUPABASE_ALLOWED_PROJECT_REFS: ref,
  DREAMSTORE_V2_SUPABASE_BUCKET: 'dreamstore-v2-staging-files',
  DREAMSTORE_V2_SUPABASE_ALLOWED_BUCKETS: 'dreamstore-v2-staging-files',
  DREAMSTORE_V2_RENDER_SUPABASE_SECRET_KEY: 'sb_secret_' + 's'.repeat(40),
  DREAMSTORE_V2_RENDER_SIGNING_SECRET: signingSecret,
  DREAMSTORE_V2_RENDER_TESTER_PASSWORD: password,
  SUPER_ADMIN_UID: 'synthetic-staging-admin',
});
test('Render accepts only named synthetic resources and dedicated Firebase key', () => {
  const c = parseRenderStagingConfig(env(), account);
  assert.equal(c.projectId, 'tidal-axis-511800-n1');
  assert.equal(c.databaseId, 'dreamstore-v2-staging');
  assert.equal(c.supabase.bucket, 'dreamstore-v2-staging-files');
});
test('Render refuses production, cloud identity spoofing, public storage and missing tester gate secrets', () => {
  const cases = [
    e => { e.DREAMSTORE_V2_STAGING = '0'; },
    e => { e.DREAMSTORE_V2_MODE = 'cloud-staging'; },
    e => { e.RENDER_SERVICE_NAME = 'other'; },
    e => { e.DREAMSTORE_V2_RENDER_PROJECT_ID = 'dulcet-trees-qk6n5'; },
    e => { e.DREAMSTORE_V2_RENDER_PROJECT_NUMBER = '582009353900'; },
    e => { e.DREAMSTORE_V2_RENDER_DATABASE_ID = '(default)'; },
    e => { e.DREAMSTORE_V2_SUPABASE_URL = 'https://unapprovedprojectid.supabase.co'; },
    e => { e.DREAMSTORE_V2_SUPABASE_BUCKET = 'production-files'; },
    e => { e.GOOGLE_APPLICATION_CREDENTIALS = '/tmp/another.json'; },
    e => { e.K_SERVICE = 'fake-cloud-run'; },
    e => { e.DREAMSTORE_V2_RENDER_TESTER_PASSWORD = ''; },
    e => { e.DREAMSTORE_PAID_CHECKOUT_ENABLED = 'true'; },
    e => { e.SUPABASE_SERVICE_ROLE_KEY = 'secret'; },
  ];
  for (const patch of cases) {
    const candidate = env(); patch(candidate);
    assert.throws(() => parseRenderStagingConfig(candidate, account));
  }
  assert.throws(() => parseRenderStagingConfig(env(), account.replace('tidal-axis-511800-n1','dulcet-trees-qk6n5')));
});
test('Render gate blocks every route until a same-origin tester login and preserves Firebase Authorization', async () => {
  const app = express();
  app.use(createRenderTesterGate({ origin, testerPassword: password, signingSecret }));
  app.get('/api/health', (req, res) => res.json({ ok: true, authorization: req.headers.authorization || null }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = (path, opts = {}) => fetch(base + path, { redirect: 'manual', headers: { Host: new URL(origin).host, ...(opts.headers || {}) }, ...opts });
  try {
    assert.equal((await request('/api/health')).status, 401);
    assert.equal((await request('/api/health', {headers: {Origin:'https://evil.example'}})).status,403);
    assert.equal((await request('/__staging/login')).status,200);
    assert.equal((await request('/__staging/login', {method:'POST', headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:'password=wrong'})).status,401);
    const login = await request('/__staging/login', {method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password})});
    assert.equal(login.status,303);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.match(login.headers.get('set-cookie'), /HttpOnly/);
    const success=await request('/api/health',{headers:{Cookie:cookie,Authorization:'Bearer synthetic-token'}});
    assert.equal(success.status,200);
    assert.equal((await success.json()).authorization,'Bearer synthetic-token');
    assert.equal((await request('/__staging/logout',{method:'POST', headers:{Origin:origin,Cookie:cookie}})).status,204);
    const badCookie=cookie.replace(/.$/,'x');
    assert.equal((await request('/api/health',{headers:{Cookie:badCookie}})).status,401);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
