import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutAttempt, applyDownloadReceipt, mergeOrderSnapshot } from '../src/lib/checkout.ts';

const intent = { buyerId: 'buyer-client', storeId: 'store-one', productId: 'original-guide', quantity: 1,
  currency: 'USD', paymentMethod: 'manual_bank', paymentReference: 'Bank:ref/with punctuation '.repeat(6),
  customerName: 'Synthetic Buyer', customerEmail: 'buyer@example.test' };
function storage() {
  const data = new Map();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
test('browser checkout keys are accepted by both APIs, opaque, and stable after a lost response', async () => {
  const tab = storage();
  const first = await checkoutAttempt(intent, tab);
  const retry = await checkoutAttempt({ ...intent }, tab);
  assert.equal(retry.key, first.key);
  assert.match(first.key, /^[A-Za-z0-9_-]{8,200}$/);
  assert.doesNotMatch(JSON.stringify([...tab.data]), /buyer@example|Bank:ref|Synthetic Buyer/);
  assert.notEqual((await checkoutAttempt({ ...intent, currency: 'PKR' }, tab)).key, first.key);
  first.complete();
  assert.notEqual((await checkoutAttempt(intent, tab)).key, first.key, 'a new confirmed purchase gets a new key');
});
test('blocked browser storage still supports a safe retry', async () => {
  const blocked = { getItem() { throw Error(); }, setItem() { throw Error(); }, removeItem() { throw Error(); } };
  const first = await checkoutAttempt({ ...intent, buyerId: 'private-mode-buyer' }, blocked);
  assert.equal((await checkoutAttempt({ ...intent, buyerId: 'private-mode-buyer' }, blocked)).key, first.key);
  first.complete();
});
test('download receipts retain rotated tokens and a stale response cannot replace a newer entitlement', () => {
  const first = applyDownloadReceipt({ downloadCount: 0, downloadToken: 'old-token' }, { downloadCount: 1, nextDownloadToken: 'next-token' });
  assert.equal(first.downloadToken, 'next-token');
  assert.deepEqual(applyDownloadReceipt(first, { downloadCount: 0, nextDownloadToken: 'stale-token' }), first);
  assert.equal(applyDownloadReceipt(first, { downloadCount: 2 }).downloadToken, 'next-token', 'V1 does not rotate tokens');
});
test('an older order poll cannot roll back a download token, while a refund still revokes it', () => {
  const current = { downloadCount: 2, downloadToken: 'current-token', paymentStatus: 'Paid' };
  const stale = { downloadCount: 1, downloadToken: 'stale-token', paymentStatus: 'Paid' };
  assert.deepEqual(mergeOrderSnapshot(current, stale), current);
  const refunded = { ...stale, paymentStatus: 'Refunded', downloadToken: 'REVOKED' };
  assert.deepEqual(mergeOrderSnapshot(current, refunded), refunded);
});
