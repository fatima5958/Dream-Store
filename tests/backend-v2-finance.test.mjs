import test from 'node:test';
import assert from 'node:assert/strict';
import { commissionBreakdown, commissionEntry } from '../server/v2/modules/commissions.ts';
import { createDownloadToken } from '../server/v2/modules/checkout.ts';
import { MemoryFirestore, MemoryBucket } from './fixtures/v2-repositories.mjs';
import { createFirestoreFinancialRepository } from '../server/v2/modules/finance-repository.ts';
import { buyerInstructions, configuredMethods } from '../server/v2/modules/payment-settings.ts';

test('commission uses rounded integer minor units at exactly 500 basis points', () => {
  assert.deepEqual(commissionBreakdown(13900, 'PKR', 'jazzcash'), {
    currency: 'PKR', commissionRateBps: 500, grossAmountMinor: 13900,
    platformCommissionMinor: 695, sellerShareBeforeFeesMinor: 13205,
    gatewayFeeMinor: 0, sellerNetEarningsMinor: 13205,
  });
  assert.equal(commissionBreakdown(1, 'USD', 'manual_bank').platformCommissionMinor, 0);
  assert.equal(commissionBreakdown(10, 'USD', 'manual_bank').platformCommissionMinor, 1);
  assert.throws(() => commissionBreakdown(1.2, 'USD', 'manual_bank'), /integer/);
});

test('commission entry is deterministic by order and preserves seller ownership', () => {
  const entry = commissionEntry({ orderNumber: 'DS-1-abc', orderId: 'order-1', storeId: 'store-seller',
    sellerId: 'seller', buyerId: 'buyer', grossAmountMinor: 20000, currency: 'INR', paymentMethod: 'upi_india' }, new Date('2026-01-01T00:00:00.000Z'));
  assert.equal(entry.entryId, 'DS-1-abc');
  assert.equal(entry.platformCommissionMinor, 1000);
  assert.equal(entry.status, 'outstanding');
  assert.equal(entry.sellerId, 'seller');
});

test('scoped download tokens are signed and secret material is required', () => {
  const order = { orderNumber: 'DS-1-abc', primaryProductId: 'book', buyerId: 'buyer', downloadTokenId: 'nonce', expiresAtMs: 2000000000000 };
  const token = createDownloadToken(order, 'a'.repeat(40));
  assert.equal(token.split('.').length, 2);
  assert.throws(() => createDownloadToken(order, 'short'), /signing/);
});

test('buyer instructions expose only configured manual receiving details', () => {
  const saved = { ownerId: 'private-owner', email: 'seller@example.test', jazzCashMerchantId: 'merchant-123',
    jazzCashEnabled: true, bankTransferInstructions: 'Transfer to Account 12345', stripeAccountId: 'acct_private',
    whatsappNotificationNumber: '+15551234567', payoneerEnabled: false };
  const safe = buyerInstructions('store-seller', saved);
  assert.deepEqual(configuredMethods(saved), ['jazzcash', 'manual_bank']);
  assert.equal(safe.jazzCashMerchantId, 'merchant-123');
  for (const key of ['ownerId', 'email', 'stripeAccountId']) assert.equal(Object.hasOwn(safe, key), false);
  assert.equal(safe.whatsappNotificationNumber, '');
  assert.equal(buyerInstructions('store-seller', { jazzCashMerchantId: 'demo merchant' }).paymentConfigured, false);
});

function financeFixture() {
  const db = new MemoryFirestore(); const bucket = new MemoryBucket();
  db.seed('stores/store-seller', { ownerId: 'seller', status: 'Active' });
  db.seed('products/book', { storeId: 'store-seller', ownerId: 'seller', isFree: false,
    published: true, status: 'Available', deleted: false, priceUsd: 10, pricePkr: 2780 });
  db.seed('sellerSettings/seller', { ownerId: 'seller', jazzCashMerchantId: 'merchant-123', jazzCashEnabled: true });
  return { db, bucket, repo: createFirestoreFinancialRepository(db, bucket) };
}
const orderInput = overrides => ({ orderNumber: 'DS-1-order', orderId: 'order-1', storeId: 'store-seller',
  sellerId: 'seller', buyerId: 'buyer', primaryProductId: 'book', customerName: 'Buyer', customerEmail: 'buyer@example.test',
  currency: 'PKR', subtotal: 27800, totalAmount: 27800, grossAmountMinor: 278000,
  currency: 'PKR', commissionRateBps: 500, platformCommissionMinor: 13900,
  sellerShareBeforeFeesMinor: 264100, gatewayFeeMinor: 0, sellerNetEarningsMinor: 264100,
  paymentMethod: 'jazzcash', paymentReference: 'TXN-10001', paymentStatus: 'Pending', verificationMode: 'Unverified',
  commissionStatus: 'outstanding', payoutStatus: 'Pending Payment Verification', downloadCount: 0, maxDownloads: 5,
  expiresAtMs: Date.now() + 86400000, downloadTokenId: 'token-first', idempotencyKey: 'idem-buyer-order-1', ...overrides });

test('Firestore order creation is durable, idempotent, and a failed commit stores nothing', async () => {
  const f = financeFixture();
  const created = await f.repo.createOrder(orderInput());
  assert.equal(created.duplicate, false);
  assert.equal(f.db.data.has('ledger/DS-1-order'), true);
  assert.equal(f.db.data.has('orders/order-1'), true);
  assert.equal(f.db.data.size, 7);
  const duplicate = await f.repo.createOrder(orderInput({ orderNumber: 'DS-2-other', orderId: 'order-2' }));
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.order.orderNumber, 'DS-1-order');

  const failed = financeFixture(); failed.db.failCommit = true;
  await assert.rejects(failed.repo.createOrder(orderInput()));
  assert.equal(failed.db.data.has('ledger/DS-1-order'), false);
  assert.equal(failed.db.data.has('checkout_idempotency/' + (await import('node:crypto')).createHash('sha256').update('buyer:idem-buyer-order-1').digest('hex')), false);
});

test('concurrent seller verification creates one commission and refund revokes its entry', async () => {
  const f = financeFixture(); await f.repo.createOrder(orderInput());
  const [a, b] = await Promise.allSettled([
    f.repo.transitionOrder('DS-1-order', 'Pending', { paymentStatus: 'Paid', verifiedByUid: 'seller' }, 'seller'),
    f.repo.transitionOrder('DS-1-order', 'Pending', { paymentStatus: 'Paid', verifiedByUid: 'seller' }, 'seller'),
  ]);
  assert.equal([a, b].filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.db.data.get('commission_entries/DS-1-order').platformCommissionMinor, 13900);
  const paid = await f.repo.order('DS-1-order');
  const path = 'deliverables/seller/book/private.pdf';
  await f.bucket.file(path).save(Buffer.from('%PDF-1.7\nsecret\n%%EOF'), { preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'application/pdf' } });
  f.db.seed('products/book/deliverables/main', { ownerId: 'seller', productId: 'book', fileName: 'private.pdf',
    fileMimeType: 'application/pdf', fileDataUrl: 'storage://' + path });
  const used = await f.repo.consumeDownload('DS-1-order', 'buyer', 'book', paid.downloadTokenId);
  assert.match(used.fileDataUrl, /^data:application\/pdf;base64,/);
  await assert.rejects(f.repo.consumeDownload('DS-1-order', 'buyer', 'book', paid.downloadTokenId), error => error.status === 403);
  await f.repo.transitionOrder('DS-1-order', 'Paid', { paymentStatus: 'Refunded', refundReference: 'REF-1' }, 'seller');
  assert.equal(f.db.data.get('commission_entries/DS-1-order').status, 'reversed');
  assert.equal(f.db.data.get('commission_adjustments/DS-1-order:refund').amountMinor, -13900);
});
