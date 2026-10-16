#!/usr/bin/env node
// Read-only verification of an owner-approved PRIVATE Cloud Run staging service.
// Never sends production tokens, mutates records, or follows HTTP redirects.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROD_PROJECT = 'dulcet-trees-qk6n5';
export const PROD_NUMBER = '582009353900';
const PROD_ORIGINS = new Set([
  'https://dreamstore.ai.studio',
  'https://dreamstore-582009353900.asia-southeast1.run.app',
  'https://ais-dev-lpudubz2xpbak4vt26y6me-149594180953.asia-southeast1.run.app',
  'https://ais-pre-lpudubz2xpbak4vt26y6me-149594180953.asia-southeast1.run.app',
  'https://ais-mob-lpudubz2xpbak4vt26y6me-149594180953.asia-southeast1.run.app',
]);
const values = input => String(input || '').split(',').map(x => x.trim()).filter(Boolean);

export function validatePrivateStagingTarget(env) {
  if (env.DREAMSTORE_V2_STAGING !== '1' || env.DREAMSTORE_V2_MODE !== 'cloud-staging') {
    throw new Error('Expected opt-in cloud staging mode.');
  }
  const projectId = String(env.DREAMSTORE_V2_CLOUD_STAGING_PROJECT_ID || '').trim();
  const projectNumber = String(env.DREAMSTORE_V2_CLOUD_STAGING_PROJECT_NUMBER || '').trim();
  if (!/^[a-z][a-z0-9-]{4,60}$/.test(projectId) || projectId === PROD_PROJECT ||
      !values(env.DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_PROJECT_IDS).includes(projectId) ||
      !/^\d{6,15}$/.test(projectNumber) || projectNumber === PROD_NUMBER ||
      !values(env.DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_PROJECT_NUMBERS).includes(projectNumber)) {
    throw new Error('Project identity is production or not explicitly allowlisted.');
  }
  const url = new URL(String(env.DREAMSTORE_V2_CLOUD_STAGING_URL || ''));
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || url.port ||
      url.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) {
    throw new Error('Expected an approved private HTTPS staging origin.');
  }
  const origin = url.origin;
  if (PROD_ORIGINS.has(origin) || origin.endsWith('.ai.studio') ||
      origin.includes(PROD_PROJECT) || origin.includes(PROD_NUMBER) ||
      !values(env.DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_ORIGINS).includes(origin)) {
    throw new Error('Staging origin is production or not allowlisted.');
  }
  const identityToken = String(env.DREAMSTORE_V2_CLOUD_RUN_ID_TOKEN || '').trim();
  if (!identityToken || identityToken.includes('\n') || identityToken.length > 16000) {
    throw new Error('A private Cloud Run invoker identity token is required.');
  }
  return { projectId, projectNumber, origin, identityToken };
}

// The Cloud Run invoker identity token uses X-Serverless-Authorization, not the
// Firebase Authorization header used by subsequent authenticated user journeys.
export async function verifyPrivateStagingReadOnly(config, fetcher = fetch) {
  const checks = [
    { name: 'health', route: '/api/health', expected: 200, accept: body =>
      body?.status === 'ok' && body?.service === 'DreamStore Multi-Vendor API' },
    { name: 'readiness', route: '/api/ready', expected: 200, accept: body => body?.status === 'ready' },
    { name: 'guest profile denied', route: '/api/users/profile', expected: 401, accept: body =>
      body?.code === 'auth/session-invalid' },
    { name: 'guest admin denied', route: '/api/admin/verify-session', expected: 401, accept: body =>
      typeof body?.code === 'string' || typeof body?.error === 'string' },
    { name: 'paid checkout disabled', route: '/api/payments/gateway-status', expected: 200, accept: body =>
      body?.paidCheckoutEnabled === false },
    { name: 'creator spots read', route: '/api/launch/creator-spots', expected: 200, accept: body =>
      body?.limit === 100 && Number.isSafeInteger(body?.claimed) &&
      Number.isSafeInteger(body?.remaining) && body.claimed >= 0 &&
      body.remaining >= 0 && body.claimed + body.remaining === 100 &&
      body.soldOut === (body.remaining === 0) },
  ];
  const results = [];
  for (const check of checks) {
    let passed = false;
    let status = null;
    try {
      const response = await fetcher(config.origin + check.route, {
        method: 'GET',
        headers: {
          'X-Serverless-Authorization': 'Bearer ' + config.identityToken,
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(12000),
      });
      status = response.status;
      if (status === check.expected &&
          (response.headers.get('content-type') || '').includes('application/json')) {
        passed = check.accept(await response.json()) === true;
      }
    } catch {
      // An error object from some HTTP transports can expose secret headers.
    }
    results.push({ name: check.name, passed, status });
  }
  return { total: checks.length, passed: results.filter(item => item.passed).length, results };
}

async function main() {
  try {
    const config = validatePrivateStagingTarget(process.env);
    const report = await verifyPrivateStagingReadOnly(config);
    for (const result of report.results) {
      console.log((result.passed ? 'PASS ' : 'FAIL ') + result.name +
        ' | HTTP ' + (result.status === null ? 'unavailable' : result.status));
    }
    console.log('Read-only staging checks: ' + report.passed + '/' + report.total);
    console.log('NOT VERIFIED: signed-in Buyer/Seller/Admin, IAM least privilege, OAuth, or cutover.');
    if (report.passed !== report.total) process.exitCode = 1;
  } catch {
    // Do not serialize credential-bearing exceptions or environment data.
    console.error('Preflight blocked: staging project, allowed origin, or private invoker access invalid.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
