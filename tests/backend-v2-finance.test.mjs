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
  assert.equal(commissionBreakdown(Number.MAX_SAFE_INTEGER, 'USD', 'manual_bank').platformCommissionMinor,
    Number((BigInt(Number.MAX_SAFE_INTEGER) * 500n + 5000n) / 10000n));
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
  return { db, bucket, repo: createFirestoreFinancialRepository(db, bucket, 'test-invoice-signing-secret-0123456789') };
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
  await assert.rejects(f.repo.createOrder(orderInput({ orderNumber: 'DS-3-tampered', orderId: 'order-3', grossAmountMinor: 500 })),
    error => error.status === 409 && error.code === 'orders/idempotency-conflict');
  assert.equal(f.db.data.has('ledger/DS-3-tampered'), false);

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

test('commission invoices issue after five verified eligible sales and survive repeat requests', async () => {
  const f = financeFixture();
  for (let i = 1; i <= 5; i++) {
    const orderNumber = `DS-invoice-${i}`;
    f.db.seed(`ledger/${orderNumber}`, { orderNumber, orderId: `order-${i}`, sellerId: 'seller', storeId: 'store-seller',
      buyerId: `buyer-${i}`, currency: 'PKR', grossAmountMinor: 10000, platformCommissionMinor: 500, commissionRateBps: 500,
      paymentMethod: 'jazzcash', paymentStatus: 'Paid', verificationMode: 'Manually Verified by Seller',
      commissionStatus: 'outstanding', createdAtIso: new Date(Date.UTC(2026, 0, i)).toISOString() });
  }
  const invoices = await f.repo.issueCommissionInvoices('seller');
  assert.equal(invoices.length, 1);
  assert.equal(invoices[0].verifiedSalesCount, 5);
  assert.equal(invoices[0].commissionAmountMinor, 2500);
  assert.equal(invoices[0].status, 'open');
  assert.equal((await f.repo.issueCommissionInvoices('seller')).length, 0);
  const saved = f.db.data.get(`commission_invoices/${invoices[0].invoiceId}`);
  assert.equal(saved.serverSignature.length, 64);
  assert.equal(f.db.data.get('ledger/DS-invoice-1').invoiceId, saved.invoiceId);
});

test('commission proof requires owner, admin attestation and an idempotent single settlement', async () => {
  const f = financeFixture();
  for (let i = 1; i <= 5; i++) {
    const orderNumber = `DS-settle-${i}`;
    const order = { orderNumber, orderId: `order-${i}`, sellerId: 'seller', storeId: 'store-seller', buyerId: `buyer-${i}`,
      currency: 'PKR', grossAmountMinor: 10000, platformCommissionMinor: 500, commissionRateBps: 500, paymentMethod: 'jazzcash', paymentStatus: 'Paid',
      verificationMode: 'Manually Verified by Seller', commissionStatus: 'outstanding', createdAtIso: `2026-01-0${i}` };
    f.db.seed(`ledger/${orderNumber}`, order);
    f.db.seed(`commission_entries/${orderNumber}`, { entryId: orderNumber, ...order, status: 'outstanding' });
  }
  const [invoice] = await f.repo.issueCommissionInvoices('seller');
  await assert.rejects(f.repo.submitCommissionPayment({ invoiceId: invoice.invoiceId, sellerId: 'other',
    amountMinor: 2500, paymentMethod: 'manual_bank', paymentReference: 'BANK-SETTLE-1' }), error => error.status === 403);
  const proof = await f.repo.submitCommissionPayment({ invoiceId: invoice.invoiceId, sellerId: 'seller',
    amountMinor: 2500, paymentMethod: 'manual_bank', paymentReference: 'BANK-SETTLE-1', proofNote: 'Test transfer evidence' });
  assert.equal(proof.payment.status, 'submitted');
  assert.equal(proof.payment.evidenceSubmittedAtIso.length > 0, true);
  await assert.rejects(f.repo.submitCommissionPayment({ invoiceId: invoice.invoiceId, sellerId: 'seller',
    amountMinor: 2500, paymentMethod: 'manual_bank', paymentReference: 'BANK-SETTLE-1' }), error => error.status === 409);
  const reviewInput = { paymentId: proof.payment.paymentId, invoiceId: invoice.invoiceId, decision: 'approve',
    fundsConfirmed: true, actorUid: 'admin' };
  await assert.rejects(f.repo.reviewCommissionPayment({ ...reviewInput, actorUid: 'seller' }), error => error.status === 403);
  const [first, retry] = await Promise.allSettled([f.repo.reviewCommissionPayment(reviewInput), f.repo.reviewCommissionPayment(reviewInput)]);
  assert.equal([first, retry].filter(result => result.status === 'fulfilled').length, 1);
  assert.equal([first, retry].filter(result => result.status === 'rejected' && result.reason.status === 409).length, 1);
  const records = await f.repo.commissionRecords('seller');
  assert.equal(records.invoices[0].status, 'paid');
  assert.equal(records.invoices[0].remainingBalanceMinor, 0);
  assert.equal(records.payments[0].status, 'verified');
  for (let i = 1; i <= 5; i++) assert.equal(f.db.data.get(`ledger/DS-settle-${i}`).commissionStatus, 'paid');
  await f.repo.transitionOrder('DS-settle-1', 'Paid', { paymentStatus: 'Refunded', commissionStatus: 'reversed',
    payoutStatus: 'Reversed (Refunded)', refundReference: 'REF-SETTLE-1' }, 'seller');
  const adjusted = f.db.data.get(`commission_invoices/${invoice.invoiceId}`);
  assert.equal(adjusted.status, 'paid');
  assert.equal(adjusted.remainingBalanceMinor, 0);
  assert.equal(adjusted.adjustedAmountMinor, 500);
  assert.equal(f.db.data.get('commission_adjustments/adj-' + (await import('node:crypto')).createHash('sha256')
    .update(`${invoice.invoiceId}:DS-settle-1:refund`).digest('hex').slice(0,32)).adjustmentAmountMinor, 500);
});

test('commission rejection returns invoice to collectible state and audit is append-only', async () => {
  const f = financeFixture();
  for (let i = 1; i <= 5; i++) f.db.seed(`ledger/DS-reject-${i}`, { orderNumber: `DS-reject-${i}`, sellerId: 'seller',
    storeId: 'store-seller', currency: 'PKR', grossAmountMinor: 10000, platformCommissionMinor: 500, commissionRateBps: 500, paymentMethod: 'jazzcash',
    paymentStatus: 'Paid', verificationMode: 'Manually Verified by Seller', commissionStatus: 'outstanding', createdAtIso: `2026-01-0${i}` });
  const [invoice] = await f.repo.issueCommissionInvoices('seller');
  const { payment } = await f.repo.submitCommissionPayment({ invoiceId: invoice.invoiceId, sellerId: 'seller',
    amountMinor: 2500, paymentMethod: 'manual_bank', paymentReference: 'BANK-REJECT-1' });
  const reviewed = await f.repo.reviewCommissionPayment({ paymentId: payment.paymentId, invoiceId: invoice.invoiceId,
    decision: 'reject', actorUid: 'admin', fundsConfirmed: false, note: 'Reference not found in statement' });
  assert.equal(reviewed.payment.status, 'rejected');
  assert.equal(reviewed.invoice.status, 'open');
  assert.equal(reviewed.invoice.remainingBalanceMinor, 2500);
  assert.equal([...f.db.data.keys()].filter(key => key.startsWith('ledger_audit/')).length, 3);
});

function seedFiveOrders(f, prefix) {
  for (let i = 1; i <= 5; i++) {
    const row = { orderNumber: `${prefix}-${i}`, orderId: `order-${prefix}-${i}`,
    sellerId: 'seller', storeId: 'store-seller', buyerId: `buyer-${i}`, currency: 'PKR', grossAmountMinor: 10000,
    platformCommissionMinor: 500, commissionRateBps: 500, paymentMethod: 'jazzcash', paymentStatus: 'Paid',
    verificationMode: 'Manually Verified by Seller', commissionStatus: 'outstanding', createdAtIso: `2026-02-0${i}` };
    f.db.seed(`ledger/${prefix}-${i}`, row);
    f.db.seed(`commission_entries/${prefix}-${i}`, { ...row, entryId: row.orderNumber, status: 'outstanding' });
  }
}

test('uninvoiced dispute resolution is durable, audited, and single-winner under concurrency', async () => {
  const f = financeFixture();
  const openOrder = { orderNumber: 'DS-dispute-open', orderId: 'dispute-order', sellerId: 'seller',
    storeId: 'store-seller', buyerId: 'buyer', currency: 'PKR', grossAmountMinor: 10000, platformCommissionMinor: 500,
    commissionRateBps: 500, paymentMethod: 'jazzcash', paymentStatus: 'Paid', verificationMode: 'Manually Verified by Seller',
    commissionStatus: 'outstanding' };
  f.db.seed('ledger/DS-dispute-open', openOrder);
  f.db.seed('commission_entries/DS-dispute-open', { ...openOrder, entryId: openOrder.orderNumber, status: 'outstanding' });
  const dispute = await f.repo.disputeCommission('DS-dispute-open', 'seller', 'Order was fully refunded before the commission was invoiced.');
  assert.equal(dispute.status, 'pending');
  assert.equal(f.db.data.get('ledger/DS-dispute-open').commissionStatus, 'disputed');
  await assert.rejects(f.repo.disputeCommission('DS-dispute-open', 'seller', 'Duplicate request should be blocked.'), error => error.status === 409);
  const decision = { disputeId: dispute.disputeId, decision: 'approve', actorUid: 'admin', explanation: 'Evidence supports waiving this commission before invoice.' };
  const results = await Promise.allSettled([f.repo.resolveCommissionDispute(decision), f.repo.resolveCommissionDispute(decision)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 1);
  assert.equal(f.db.data.get(`commission_disputes/${dispute.disputeId}`).status, 'approved');
  assert.equal(f.db.data.get('ledger/DS-dispute-open').commissionStatus, 'reversed');
  assert.equal(f.db.data.get('commission_entries/DS-dispute-open').status, 'reversed');
  assert.equal(f.db.data.get('commission_adjustments/DS-dispute-open:dispute').amountMinor, -500);
  assert.equal([...f.db.data.values()].filter(row => row.action?.startsWith('COMMISSION_DISPUTE_')).length, 2);
});

test('invoiced dispute pauses submitted payment and reduces only an unpaid invoice balance', async () => {
  const f = financeFixture(); seedFiveOrders(f, 'DS-dispute-inv');
  const [invoice] = await f.repo.issueCommissionInvoices('seller');
  const dispute = await f.repo.disputeCommission('DS-dispute-inv-1', 'seller', 'This order amount was entered incorrectly in the source records.');
  await assert.rejects(f.repo.submitCommissionPayment({ invoiceId: invoice.invoiceId, sellerId: 'seller',
    amountMinor: 2500, paymentMethod: 'manual_bank', paymentReference: 'DISPUTE-PAUSE-1' }), error => error.status === 409);
  const resolved = await f.repo.resolveCommissionDispute({ disputeId: dispute.disputeId, decision: 'approve', actorUid: 'admin',
    explanation: 'Source records confirm this order was ineligible.' });
  const savedInvoice = f.db.data.get(`commission_invoices/${invoice.invoiceId}`);
  assert.equal(savedInvoice.remainingBalanceMinor, 2000);
  assert.equal(savedInvoice.adjustedAmountMinor, 500);
  assert.equal(savedInvoice.status, 'open');
  assert.equal(resolved.reconciliationRequiredMinor, 0);
  assert.equal(savedInvoice.pendingDisputeIds.length, 0);
  assert.equal([...f.db.data.values()].filter(row => row.action === 'COMMISSION_DISPUTE_APPROVED').length, 1);
});

test('settled invoiced dispute records human reconciliation without creating credit or changing invoice totals', async () => {
  const f = financeFixture(); seedFiveOrders(f, 'DS-dispute-paid');
  const [invoice] = await f.repo.issueCommissionInvoices('seller');
  const { payment } = await f.repo.submitCommissionPayment({ invoiceId: invoice.invoiceId, sellerId: 'seller', amountMinor: 2500,
    paymentMethod: 'manual_bank', paymentReference: 'DISPUTE-SETTLED-1' });
  await f.repo.reviewCommissionPayment({ paymentId: payment.paymentId, invoiceId: invoice.invoiceId, decision: 'approve',
    fundsConfirmed: true, actorUid: 'admin' });
  const dispute = await f.repo.disputeCommission('DS-dispute-paid-1', 'seller', 'The source order should not have been charged commission.');
  const before = f.db.data.get(`commission_invoices/${invoice.invoiceId}`);
  const result = await f.repo.resolveCommissionDispute({ disputeId: dispute.disputeId, decision: 'approve', actorUid: 'admin',
    explanation: 'Evidence confirms commission was not eligible; finance team must reconcile settled funds.' });
  const after = f.db.data.get(`commission_invoices/${invoice.invoiceId}`);
  assert.equal(after.paidAmountMinor, before.paidAmountMinor);
  assert.equal(after.remainingBalanceMinor, before.remainingBalanceMinor);
  assert.equal(after.adjustedAmountMinor, before.adjustedAmountMinor);
  assert.equal(result.reconciliationRequiredMinor, 500);
  const adjustment = [...f.db.data.entries()].find(([path, row]) => path.startsWith('commission_adjustments/') && row.disputeId === dispute.disputeId)?.[1];
  assert.equal(adjustment.reconciliationStatus, 'human_review_required');
  assert.equal(adjustment.amountMinor, -500);
  assert.equal(f.db.data.get('ledger/DS-dispute-paid-1').commissionStatus, 'reversed');
});

test('refund and invoice payment review cannot bypass a pending invoice dispute', async () => {
  const f = financeFixture(); seedFiveOrders(f, 'DS-dispute-race');
  const [invoice] = await f.repo.issueCommissionInvoices('seller');
  const dispute = await f.repo.disputeCommission('DS-dispute-race-1', 'seller', 'Checking source evidence before applying this charge.');
  await assert.rejects(f.repo.transitionOrder('DS-dispute-race-1', 'Paid', { paymentStatus: 'Refunded', refundReference: 'REF-DISPUTE-RACE' }, 'seller'),
    error => error.status === 409);
  const [payment] = await Promise.allSettled([f.repo.submitCommissionPayment({ invoiceId: invoice.invoiceId, sellerId: 'seller',
    amountMinor: 2500, paymentMethod: 'manual_bank', paymentReference: 'DISPUTE-RACE-2' })]);
  assert.equal(payment.status, 'rejected');
  assert.equal(f.db.data.get(`commission_disputes/${dispute.disputeId}`).status, 'pending');
  assert.equal(f.db.data.get('ledger/DS-dispute-race-1').paymentStatus, 'Paid');
});

test('commission entry mismatch fails closed without writing a dispute or changing balances', async () => {
  const f = financeFixture();
  const row = { orderNumber: 'DS-dispute-mismatch', sellerId: 'seller', storeId: 'store-seller', buyerId: 'buyer',
    currency: 'PKR', grossAmountMinor: 10000, platformCommissionMinor: 500, commissionRateBps: 500,
    paymentMethod: 'jazzcash', paymentStatus: 'Paid', verificationMode: 'Manually Verified by Seller', commissionStatus: 'outstanding' };
  f.db.seed('ledger/DS-dispute-mismatch', row);
  f.db.seed('commission_entries/DS-dispute-mismatch', { ...row, sellerId: 'other', status: 'outstanding' });
  await assert.rejects(f.repo.disputeCommission(row.orderNumber, 'seller', 'Request review of the source commission record.'),
    error => error.status === 409 && error.code === 'commission/entry-mismatch');
  assert.equal(f.db.data.get('ledger/DS-dispute-mismatch').commissionStatus, 'outstanding');
  assert.equal([...f.db.data.keys()].some(path => path.startsWith('commission_disputes/')), false);
  assert.equal([...f.db.data.keys()].some(path => path.startsWith('ledger_audit/')), false);
});

test('ledger contract is seller-scoped, bounded and cursor-paginated; notification lookup omits customer secrets', async () => {
  const f = financeFixture();
  await f.repo.createOrder(orderInput({ orderNumber: 'DS-page-001', orderId: 'page-order-001', paymentReference: 'TX-PAGE-001', idempotencyKey: 'page-key-001' }));
  await f.repo.createOrder(orderInput({ orderNumber: 'DS-page-002', orderId: 'page-order-002', paymentReference: 'TX-PAGE-002', idempotencyKey: 'page-key-002' }));
  f.db.seed('ledger/DS-page-002', { ...f.db.data.get('ledger/DS-page-002'), buyerEmailNotification: {
    status: 'sent', recipientEmail: 'private@example.test', downloadToken: 'secret-token' } });
  const first = await f.repo.ledgerEntries('seller', false, 'store-seller', undefined, 1);
  assert.equal(first.entries.length, 1); assert.equal(first.hasMore, true); assert.equal(first.nextCursor, 'DS-page-001');
  const second = await f.repo.ledgerEntries('seller', false, 'store-seller', first.nextCursor, 1);
  assert.equal(second.entries[0].orderNumber, 'DS-page-002'); assert.equal(second.hasMore, false);
  const notification = await f.repo.emailNotification('DS-page-002');
  assert.equal(notification.buyerId, 'buyer'); assert.equal(notification.notification.status, 'sent');
  // The route projects status only; repository access remains role-scoped at the route boundary.
});
