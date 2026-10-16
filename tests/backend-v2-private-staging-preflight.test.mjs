import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePrivateStagingTarget, verifyPrivateStagingReadOnly }
  from '../scripts/v2-private-staging-preflight.mjs';

const environment = () => ({
  DREAMSTORE_V2_STAGING: '1',
  DREAMSTORE_V2_MODE: 'cloud-staging',
  DREAMSTORE_V2_CLOUD_STAGING_PROJECT_ID: 'dreamstore-stage-23',
  DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_PROJECT_IDS: 'dreamstore-stage-23',
  DREAMSTORE_V2_CLOUD_STAGING_PROJECT_NUMBER: '123456789',
  DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_PROJECT_NUMBERS: '123456789',
  DREAMSTORE_V2_CLOUD_STAGING_URL: 'https://dreamstore-v2-stage-abc.region.run.app',
  DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_ORIGINS: 'https://dreamstore-v2-stage-abc.region.run.app',
  DREAMSTORE_V2_CLOUD_RUN_ID_TOKEN: 'synthetic-invoker-token',
});
const reply = (body, status = 200) =>
  Response.json(body, { status, headers: { 'Content-Type': 'application/json' } });

test('preflight rejects unapproved and production identities and endpoints without network access', () => {
  assert.equal(validatePrivateStagingTarget(environment()).projectNumber, '123456789');
  for (const mutate of [
    e => { e.DREAMSTORE_V2_STAGING = '0'; },
    e => { e.DREAMSTORE_V2_MODE = 'emulator'; },
    e => { e.DREAMSTORE_V2_CLOUD_STAGING_PROJECT_ID = 'dulcet-trees-qk6n5';
      e.DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_PROJECT_IDS = 'dulcet-trees-qk6n5'; },
    e => { e.DREAMSTORE_V2_CLOUD_STAGING_PROJECT_NUMBER = '582009353900';
      e.DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_PROJECT_NUMBERS = '582009353900'; },
    e => { e.DREAMSTORE_V2_CLOUD_STAGING_PROJECT_NUMBER = '987654321'; },
    e => { e.DREAMSTORE_V2_CLOUD_STAGING_URL = 'https://dreamstore.ai.studio';
      e.DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_ORIGINS = 'https://dreamstore.ai.studio'; },
    e => { e.DREAMSTORE_V2_CLOUD_STAGING_URL = 'https://dreamstore-582009353900.asia-southeast1.run.app';
      e.DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_ORIGINS = e.DREAMSTORE_V2_CLOUD_STAGING_URL; },
    e => { e.DREAMSTORE_V2_CLOUD_STAGING_URL = 'http://127.0.0.1:8080'; },
    e => { e.DREAMSTORE_V2_CLOUD_STAGING_URL = 'https://example.org/?redirect=production'; },
    e => { e.DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_ORIGINS = ''; },
    e => { e.DREAMSTORE_V2_CLOUD_RUN_ID_TOKEN = ''; },
  ]) {
    const candidate = environment(); mutate(candidate);
    assert.throws(() => validatePrivateStagingTarget(candidate));
  }
});

test('private Cloud Run smoke checks only GET routes and never sends Firebase Authorization', async () => {
  const config = validatePrivateStagingTarget(environment());
  const responses = new Map([
    ['/api/health', reply({ status: 'ok', service: 'DreamStore Multi-Vendor API' })],
    ['/api/ready', reply({ status: 'ready' })],
    ['/api/users/profile', reply({ code: 'auth/session-invalid' }, 401)],
    ['/api/admin/verify-session', reply({ error: 'Verified admin required.' }, 401)],
    ['/api/payments/gateway-status', reply({ paidCheckoutEnabled: false })],
    ['/api/launch/creator-spots', reply({ limit: 100, claimed: 37, remaining: 63, soldOut: false })],
  ]);
  const seen = [];
  const report = await verifyPrivateStagingReadOnly(config, async (url, opts) => {
    seen.push({ url, opts });
    return responses.get(new URL(url).pathname);
  });
  assert.equal(report.passed, 6);
  assert.equal(report.total, 6);
  for (const call of seen) {
    assert.equal(call.opts.method, 'GET');
    assert.equal(call.opts.redirect, 'manual');
    assert.equal(call.opts.headers.Authorization, undefined);
    assert.equal(call.opts.headers['X-Serverless-Authorization'], 'Bearer synthetic-invoker-token');
    assert.ok(call.url.startsWith(config.origin + '/api/'));
  }
  assert.equal(JSON.stringify(report).includes('synthetic-invoker-token'), false);
});

test('preflight fails closed on readiness, privilege, and campaign discrepancies', async () => {
  const config = validatePrivateStagingTarget(environment());
  const report = await verifyPrivateStagingReadOnly(config, async url => {
    if (url.endsWith('/api/ready')) return reply({ status: 'not_ready' }, 503);
    // An accidental publicly readable admin session must fail even if healthy.
    if (url.endsWith('/api/admin/verify-session')) return reply({ ok: true, isSuperAdmin: true }, 200);
    if (url.endsWith('/api/launch/creator-spots')) {
      return reply({ limit: 100, claimed: 10, remaining: 95, soldOut: false });
    }
    return reply({ error: 'unexpected' }, 401);
  });
  assert.equal(report.passed, 0);
  assert.equal(report.results.find(x => x.name === 'readiness').status, 503);
});

test('preflight does not follow cross-origin redirects', async () => {
  const config = validatePrivateStagingTarget(environment());
  let count = 0;
  const report = await verifyPrivateStagingReadOnly(config, async (_url, opts) => {
    count++;
    assert.equal(opts.redirect, 'manual');
    return new Response('', { status: 302, headers: { Location: 'https://dreamstore.ai.studio/' } });
  });
  assert.equal(count, 6);
  assert.equal(report.passed, 0);
});
