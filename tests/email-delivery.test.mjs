import test from 'node:test';
import assert from 'node:assert/strict';
import { sendBuyerOrderEmail } from '../server/email.ts';

const message = { apiKey: 'synthetic-private-test-key', from: 'audit@example.test', recipient: 'buyer@example.test',
  subject: 'Synthetic receipt', html: '<p>Synthetic receipt</p>', orderNumber: 'DS-audit-email' };
test('unconfigured email never claims a receipt was sent and makes no external call', async () => {
  const result = await sendBuyerOrderEmail({ ...message, apiKey: '' }, () => { throw Error('Must not call'); });
  assert.equal(result.status, 'skipped');
  assert.equal(result.deliveryProvider, 'secure_outbox');
});
test('only provider acceptance counts as sent; retry keys are stable and redirects are refused', async () => {
  const keys = [];
  for (let i = 0; i < 2; i++) {
    const result = await sendBuyerOrderEmail(message, async (url, options) => {
      assert.equal(url, 'https://api.resend.com/emails'); assert.equal(options.redirect, 'error');
      assert.equal(options.signal.aborted, false);
      keys.push(options.headers['Idempotency-Key']);
      return Response.json({ id: 'synthetic-provider-receipt' });
    });
    assert.equal(result.status, 'sent');
  }
  assert.equal(keys[0], keys[1]);
});
test('provider rejection and transport failure report failure without leaking provider details', async () => {
  for (const provider of [async () => new Response('private provider details', { status: 500 }),
    async () => { throw Error('private provider details: ' + message.apiKey); }]) {
    const result = await sendBuyerOrderEmail(message, provider);
    assert.equal(result.status, 'failed');
    assert.doesNotMatch(JSON.stringify(result), /private provider details|synthetic-private-test-key/);
  }
});
