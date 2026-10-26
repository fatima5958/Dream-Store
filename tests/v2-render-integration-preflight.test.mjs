import test from 'node:test';
import assert from 'node:assert/strict';
import { runRenderIntegrationPreflight, STAGING_ORIGIN } from '../scripts/v2-render-integration-preflight.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const cookie = '__Host-dreamstore-v2-stage=synthetic';
function fakeTransport({ ready = true, correctLogin = true } = {}) {
  const requests = [];
  async function fetcher(url, init = {}) {
    const u = new URL(url);
    requests.push({ path: u.pathname, method: init.method || 'GET', init });
    assert.equal(u.origin, STAGING_ORIGIN);
    if (u.pathname === '/__staging/login' && init.method === 'POST') {
      const payload = new URLSearchParams(init.body);
      assert.equal(payload.get('password'), 'synthetic-private-value');
      return correctLogin ? new Response(null, {
        status: 303, headers: { 'Set-Cookie': cookie + '; Path=/; Secure; HttpOnly; SameSite=Strict', Location: '/api/health' },
      }) : json({ code: 'staging/access-denied' }, 401);
    }
    if (u.pathname === '/__staging/login') return new Response('<form></form>', { headers: { 'Content-Type': 'text/html' } });
    if (u.pathname === '/api/health' && !init.headers?.Cookie) return json({ code: 'staging/access-required' }, 401);
    if (u.pathname === '/api/health') return json({ status: 'ok' });
    if (u.pathname === '/api/ready') return json({ status: ready ? 'ready' : 'not_ready' }, ready ? 200 : 503);
    if (u.pathname === '/api/payments/gateway-status') return json({ paidCheckoutEnabled: false, jazzcashConfigured: false, stripeConfigured: false });
    if (u.pathname === '/api/users/profile' || u.pathname === '/api/admin/verify-session') return json({ error: 'auth-required' }, 401);
    throw new Error('Unexpected request: ' + u.pathname);
  }
  return { fetcher, requests };
}

test('Read-only staging probe passes with valid isolated dependencies and denied guests', async () => {
  const t = fakeTransport();
  const lines = [];
  const result = await runRenderIntegrationPreflight({ password: 'synthetic-private-value', fetcher: t.fetcher, report: l => lines.push(l) });
  assert.equal(result.passed, true);
  assert.equal(result.checks.length, 8);
  assert.ok(t.requests.every(r => r.method === 'GET' || r.path === '/__staging/login'));
  assert.doesNotMatch(lines.join('\n'), /synthetic-private-value|__Host-dreamstore-v2-stage=/);
});

test('Readiness 503 blocks promotion, never reports healthy from just liveness', async () => {
  const result = await runRenderIntegrationPreflight({ password: 'synthetic-private-value', fetcher: fakeTransport({ ready: false }).fetcher });
  assert.equal(result.passed, false);
  assert.equal(result.checks.find(c => c.name.includes('readiness')).pass, false);
});

test('Bad login stops without probing private resources or retrying password', async () => {
  const t = fakeTransport({ correctLogin: false });
  const result = await runRenderIntegrationPreflight({ password: 'synthetic-private-value', fetcher: t.fetcher });
  assert.equal(result.passed, false);
  assert.equal(t.requests.filter(r => r.method === 'POST').length, 1);
  assert.ok(t.requests.every(r => !['/api/ready', '/api/users/profile'].includes(r.path)));
});

test('Missing password and wrong origin fail closed before requests', async () => {
  const t = fakeTransport();
  await assert.rejects(runRenderIntegrationPreflight({ password: '', fetcher: t.fetcher }), /password is required/);
  await assert.rejects(runRenderIntegrationPreflight({ origin: 'https://dreamstore.ai.studio', password: 'not-a-real-secret', fetcher: t.fetcher }), /Only approved/);
  assert.equal(t.requests.length, 0);
});
