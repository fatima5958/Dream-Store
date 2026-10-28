#!/usr/bin/env node
// Read-only V2 Render integration gate. No payment, account, store, or file writes.
// Tester password is consumed from the caller's environment, never a URL or CLI arg.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const STAGING_ORIGIN = 'https://dreamstore-v2-staging.onrender.com';

export async function runRenderIntegrationPreflight({
  origin = STAGING_ORIGIN,
  password,
  fetcher = fetch,
  report = () => {},
} = {}) {
  if (origin !== STAGING_ORIGIN) throw new Error('Only approved isolated Render staging may be tested.');
  if (typeof password !== 'string' || !password) throw new Error('A private staging tester password is required.');
  const checked = [];
  const check = (name, pass) => {
    checked.push({ name, pass: Boolean(pass) });
    report((pass ? 'PASS ' : 'FAIL ') + name);
    return Boolean(pass);
  };
  const request = (path, init = {}) => fetcher(STAGING_ORIGIN + path, {
    redirect: 'manual',
    signal: AbortSignal.timeout(90000), // Render Free cold start can exceed normal HTTP timeouts.
    ...init,
  });

  // A guest must not access APIs, even if Render's root page appears alive.
  const unauthorized = await request('/api/health');
  check('Tester gate rejects unauthenticated requests', unauthorized.status === 401);

  const loginPage = await request('/__staging/login');
  check('Tester login route available', loginPage.status === 200 &&
    (loginPage.headers.get('content-type') || '').includes('text/html'));

  // Exactly one login attempt: avoid amplifying credential guesses and lockout.
  const login = await request('/__staging/login', {
    method: 'POST',
    headers: { Origin: STAGING_ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password }),
  });
  const setCookie = login.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  const loginAccepted = login.status === 303 &&
    /^__Host-dreamstore-v2-stage=[^;]+$/.test(cookie) &&
    /;\s*HttpOnly(?:;|$)/i.test(setCookie) &&
    /;\s*Secure(?:;|$)/i.test(setCookie) &&
    /;\s*SameSite=Strict(?:;|$)/i.test(setCookie);
  if (!check('One-time tester login sets hardened cookie', loginAccepted)) {
    report('STOP Staging login failed; no privileged or data routes checked.');
    return { passed: false, checks: checked };
  }

  const authedGet = path => request(path, { headers: { Cookie: cookie } });
  const health = await authedGet('/api/health');
  const healthJson = await health.json().catch(() => ({}));
  check('V2 API health', health.status === 200 && healthJson.status === 'ok');

  const ready = await authedGet('/api/ready');
  const readyJson = await ready.json().catch(() => ({}));
  check('V2 Firebase/Auth/Firestore/Supabase readiness', ready.status === 200 && readyJson.status === 'ready');

  const flags = await authedGet('/api/payments/gateway-status');
  const flagJson = await flags.json().catch(() => ({}));
  check('Staging paid checkout and automated gateways off', flags.status === 200 &&
    flagJson.paidCheckoutEnabled === false &&
    flagJson.jazzcashConfigured === false && flagJson.stripeConfigured === false);

  const profile = await authedGet('/api/users/profile');
  check('Guest cannot read a private user profile', profile.status === 401);
  const admin = await authedGet('/api/admin/verify-session');
  check('Guest cannot enter Super Admin', admin.status === 401);

  return { passed: checked.every(c => c.pass), checks: checked };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRenderIntegrationPreflight({
    password: process.env.DREAMSTORE_V2_RENDER_TESTER_PASSWORD,
    report: message => console.log(message),
  }).then(result => {
    if (!result.passed) process.exitCode = 1;
  }).catch(() => {
    // No provider exception details or password values in deployment logs.
    console.error('FAIL V2 staging integration preflight could not complete.');
    process.exitCode = 1;
  });
}
