#!/usr/bin/env node
// Staging-only smoke gate. Never accepts credentials or conducts real payments.
// Green checks here do NOT certify Firebase production rules, migrations, or funds.
const raw = process.argv[2] || process.env.DREAMSTORE_STAGING_URL || '';
if (!raw) {
  console.error('Usage: npm run release:preflight -- https://YOUR-STAGING-HOST');
  process.exitCode = 1;
} else {
  try {
    const origin = new URL(raw);
    const localhost = ['localhost', '127.0.0.1'].includes(origin.hostname);
    if (origin.username || origin.password ||
        (origin.protocol !== 'https:' && !(localhost && origin.protocol === 'http:'))) {
      throw new Error('Use an HTTPS staging origin without embedded credentials.');
    }
    const checks = [
      ['App health', '/api/health', 'GET', 200, 'ok'],
      ['Backend + Firebase readiness', '/api/ready', 'GET', 200, 'ready'],
      ['Public store catalog', '/api/stores', 'GET', 200],
      ['Public payment feature flags', '/api/payments/gateway-status', 'GET', 200],
      ['Private order list denied to guests', '/api/orders/list', 'GET', 401],
      ['Admin session denied to guests', '/api/admin/verify-session', 'GET', 401],
      ['Private profile denied to guests', '/api/users/profile', 'GET', 401],
      ['Commission admin ledger denied to guests', '/api/commission/admin/overview', 'GET', 401],
      ['Order payment approval denied to guests', '/api/orders/verify-payment', 'POST', 401],
      ['Refund processing denied to guests', '/api/orders/refund', 'POST', 401],
      ['Commission settlement denied to guests', '/api/commission/verify-payment', 'POST', 401],
      ['Unverified auto-payment webhook rejected', '/api/webhooks/payoneer', 'POST', 503],
    ];
    let failures = 0;
    for (const [label, route, method, expected, expectedStatus] of checks) {
      try {
        const response = await fetch(new URL(route, origin), {
          method,
          redirect: 'manual',
          headers: { 'content-type': 'application/json' },
          ...(method === 'POST' ? { body: '{}' } : {}),
          signal: AbortSignal.timeout(12000),
        });
        const json = await response.json().catch(() => ({}));
        const isGatewayStatus = route === '/api/payments/gateway-status';
        // The staging preflight is a public-preview gate, not paid production certification.
        // Fail if paid checkout was switched on before human finance approval.
        const checkoutSafelyDisabled = !isGatewayStatus ||
          json.paidCheckoutEnabled === false;
        const pass = response.status === expected &&
          (!expectedStatus || json.status === expectedStatus) &&
          checkoutSafelyDisabled;
        console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: HTTP ${response.status} (expected ${expected})` +
          (isGatewayStatus ? ` | paid checkout disabled: ${checkoutSafelyDisabled}` : ''));
        if (!pass) failures++;
      } catch (error) {
        failures++;
        console.error(`FAIL ${label}: ${error instanceof Error ? error.message : 'Network failure'}`);
      }
    }
    console.log('\nStaging network checks: ' + (checks.length - failures) + '/' + checks.length + ' passed.');
    console.log('Required separately: live seller/buyer tests, rules deployment, account migration,');
    console.log('commission and refund reconciliation, actual statement checks, and rollback proof.');
    if (failures > 0) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid staging origin');
    process.exitCode = 1;
  }
}
