import test from 'node:test';
import assert from 'node:assert/strict';
import { createV2App } from '../server/v2/app.ts';
import { createFirestoreFinancialRepository } from '../server/v2/modules/finance-repository.ts';
import { createFirestoreCommissionRepository } from '../server/v2/modules/commission-repository.ts';
import { invoiceLifecycle, paymentLifecycle, ledgerCommissionLifecycle } from '../server/v2/modules/commission-lifecycle.ts';
import { MemoryFirestore, MemoryBucket } from './fixtures/v2-repositories.mjs';

// NOTE: these run against a strictly-serialized in-memory Firestore fake (see fixtures/v2-repositories.mjs).
// They prove business rules and serializable concurrency behavior, NOT real Firestore contention retries.
const SECRET = 's'.repeat(48);
const ADMIN = 'admin_uid';
const identities = {
  [ADMIN]: { uid: ADMIN, email: 'admin@example.test', emailVerified: true, displayName: 'Admin', roleClaim: 'super_admin', superAdminClaim: true },
};
const principalFor = uid => identities[uid] || { uid, email: uid + '@example.test', emailVerified: true, displayName: uid };

function build({ allowWrites = true } = {}) {
  const db = new MemoryFirestore(); const bucket = new MemoryBucket();
  const profiles = new Map([
    ['sellerA', 'seller'], ['sellerB', 'seller'], ['buyerA', 'buyer'], ['buyerB', 'buyer'],
  ]);
  db.seed('stores/store-sellerA', { ownerId: 'sellerA', status: 'Active' });
  db.seed('stores/store-sellerB', { ownerId: 'sellerB', status: 'Active' });
  for (const s of ['A', 'B']) {
    db.seed(`products/book${s}`, { storeId: `store-seller${s}`, ownerId: `seller${s}`, isFree: false, published: true,
      status: 'Available', deleted: false, priceUsd: 10, pricePkr: 2780, title: 'Book ' + s });
    db.seed(`sellerSettings/seller${s}`, { ownerId: `seller${s}`, jazzCashMerchantId: 'merchant-123', jazzCashEnabled: true });
  }
  const finance = createFirestoreFinancialRepository(db, bucket);
  const commissions = createFirestoreCommissionRepository(db, { signingSecret: SECRET });
  const deps = {
    auth: { async verifyBearer(token) { return principalFor(token.split('.')[1]); } },
    profiles: { async find(p) { const role = profiles.get(p.uid); return role ? { uid: p.uid, role, onboardingCompleted: true, displayName: p.uid, email: p.email } : null; }, async save() { throw new Error('unused'); } },
    creators: { async read() { return { limit: 100, claimed: 0, remaining: 100, soldOut: false, offer: 'free_storefront_setup' }; } },
    products: { async list(storeId) { return [...db.data].filter(([k]) => k.startsWith('products/') && k.split('/').length === 2 && db.data.get(k).storeId === storeId && db.data.get(k).published)
      .map(([k, v]) => ({ id: k.split('/')[1], ...v })); } },
    finance, commissions, readiness: { async check() { return true; } },
    adminUid: ADMIN, allowWrites, paidCheckoutEnabled: true, downloadTokenSecret: SECRET,
  };
  return { db, finance, commissions, app: createV2App(deps), deps };
}

async function serve(app, run) {
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const call = async (method, path, uid, body) => {
      const res = await fetch(base + path, { method,
        headers: { ...(uid ? { authorization: `Bearer fixture.${uid}.signature` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      return [res.status, await res.json()];
    };
    await run({ get: (p, u) => call('GET', p, u), post: (p, u, b) => call('POST', p, u, b) });
  } finally { await new Promise(resolve => server.close(resolve)); }
}

let counter = 0;
const orderInput = (sellerId, overrides = {}) => {
  const n = ++counter; const s = sellerId.slice(-1);
  return { orderNumber: `DS-${n}-ord`, orderId: `order-${n}`, storeId: `store-${sellerId}`, sellerId, buyerId: 'buyerA',
    primaryProductId: `book${s}`, customerName: 'Buyer', customerEmail: 'buyerA@example.test', currency: 'PKR',
    subtotal: 2780, totalAmount: 2780, grossAmountMinor: 278000, commissionRateBps: 500, platformCommissionMinor: 13900,
    sellerShareBeforeFeesMinor: 264100, gatewayFeeMinor: 0, sellerNetEarningsMinor: 264100, paymentMethod: 'jazzcash',
    paymentReference: `TXN-${10000 + n}`, paymentStatus: 'Pending', verificationMode: 'Unverified', commissionStatus: 'outstanding',
    payoutStatus: 'Pending Payment Verification', downloadCount: 0, maxDownloads: 5, expiresAtMs: Date.now() + 86400000,
    createdAtIso: new Date(Date.now() + n).toISOString(), downloadTokenId: `tok-${n}`, idempotencyKey: `idem-key-${n}-abcdefgh`, ...overrides };
};
const verifyBody = (order, extra = {}) => ({ orderNumber: order.orderNumber, newStatus: 'Paid', statementConfirmed: true, ...extra });

/** Create + seller-verify `count` orders for a seller through the real HTTP route. */
async function paidOrders(f, api, sellerId, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const input = orderInput(sellerId); await f.finance.createOrder(input);
    const [status, body] = await api.post('/api/orders/verify-payment', sellerId, verifyBody(input));
    assert.equal(status, 200, JSON.stringify(body)); out.push(input);
  }
  return out;
}
const auditActions = db => [...db.data].filter(([k]) => k.startsWith('ledger_audit/')).map(([, v]) => v.action);

test('lifecycle mappings are explicit and never rewrite stored statuses', () => {
  assert.equal(invoiceLifecycle('open', 100, 0), 'outstanding');
  assert.equal(invoiceLifecycle('overdue', 100, 0), 'outstanding');
  assert.equal(invoiceLifecycle('payment_submitted', 100, 0), 'proof_submitted');
  assert.equal(invoiceLifecycle('paid', 0, 100), 'settled');
  assert.equal(invoiceLifecycle('voided', 0, 0), 'reversed');
  assert.equal(invoiceLifecycle('open', 0, 0), 'reversed'); // fully adjusted away, nothing ever paid
  assert.equal(paymentLifecycle('submitted'), 'proof_submitted');
  assert.equal(paymentLifecycle('verified'), 'settled');
  assert.equal(paymentLifecycle('rejected'), 'rejected');
  assert.equal(ledgerCommissionLifecycle('disputed'), 'disputed');
  assert.equal(ledgerCommissionLifecycle('paid'), 'settled');
});

test('verified sales are invoiced in exact batches of five, once, with exact integer totals', async () => {
  const f = build();
  await serve(f.app, async api => {
    await paidOrders(f, api, 'sellerA', 4);
    let [, summary] = await api.get('/api/commission/status', 'sellerA');
    assert.equal(summary.invoices.length, 0);
    assert.equal(summary.salesTowardNextInvoice, 4);
    assert.equal(summary.unbilledCommissionMinor, 4 * 13900);
    await paidOrders(f, api, 'sellerA', 1);
    [, summary] = await api.get('/api/commission/status', 'sellerA');
    assert.equal(summary.invoices.length, 1);
    const [invoice] = summary.invoices;
    assert.equal(invoice.commissionAmountMinor, 5 * 13900);
    assert.equal(invoice.remainingBalanceMinor, 5 * 13900);
    assert.equal(invoice.status, 'open'); assert.equal(invoice.lifecycleStatus, 'outstanding');
    assert.equal(invoice.orderNumbers.length, 5);
    assert.equal(summary.salesTowardNextInvoice, 0);
    assert.equal(summary.totalOutstandingCommissionMinor, 5 * 13900);
    // Concurrent issuers converge on the single deterministic invoice.
    const results = await Promise.all(Array.from({ length: 6 }, () => f.commissions.issueInvoices('sellerA')));
    assert.equal(results.reduce((a, b) => a + b, 0), 0);
    assert.equal([...f.db.data.keys()].filter(k => k.startsWith('commission_invoices/')).length, 1);
    assert.equal(auditActions(f.db).filter(a => a === 'COMMISSION_INVOICE_ISSUED').length, 1);
  });
});

test('commission proof: only the owning Seller can submit; everyone else is denied', async () => {
  const f = build();
  await serve(f.app, async api => {
    await paidOrders(f, api, 'sellerA', 5);
    const [, { invoices: [invoice] }] = await api.get('/api/commission/status', 'sellerA');
    const proof = { invoiceId: invoice.invoiceId, paymentMethod: 'bank_transfer', paymentReference: 'COMM-REF-001', proofNote: 'test' };
    assert.equal((await api.post('/api/commission/submit-payment', null, proof))[0], 401);
    assert.equal((await api.post('/api/commission/submit-payment', 'sellerB', proof))[0], 403); // other Seller
    assert.equal((await api.post('/api/commission/submit-payment', 'buyerA', proof))[0], 403);  // Buyer
    const [adminStatus, adminBody] = await api.post('/api/commission/submit-payment', ADMIN, proof);
    assert.equal(adminStatus, 403); assert.equal(adminBody.code, 'commission/admin-cannot-submit');
    assert.equal((await api.post('/api/commission/submit-payment', 'sellerA', { ...proof, sellerId: 'sellerB' }))[0], 403);
    assert.equal([...f.db.data.keys()].filter(k => k.startsWith('commission_payments/')).length, 0); // nothing leaked in
    const [ok, accepted] = await api.post('/api/commission/submit-payment', 'sellerA', proof);
    assert.equal(ok, 200);
    assert.equal(accepted.payment.status, 'submitted'); assert.equal(accepted.payment.lifecycleStatus, 'proof_submitted');
    assert.equal(accepted.invoice.status, 'payment_submitted');
    assert.equal(accepted.invoice.remainingBalanceMinor, 5 * 13900, 'a submitted proof must NOT reduce the balance');
    assert.equal((await api.post('/api/commission/submit-payment', 'sellerA', { ...proof, paymentReference: 'COMM-REF-002' }))[1].code, 'commission/proof-pending');
    // The same transfer reference can never be used twice.
    assert.equal((await api.post('/api/commission/submit-payment', 'sellerA', proof))[0], 409);
  });
});

test('commission proof validation rejects bad amounts, short references and unknown invoices', async () => {
  const f = build();
  await serve(f.app, async api => {
    await paidOrders(f, api, 'sellerA', 5);
    const [, { invoices: [invoice] }] = await api.get('/api/commission/status', 'sellerA');
    const base = { invoiceId: invoice.invoiceId, paymentMethod: 'bank_transfer', paymentReference: 'COMM-REF-100' };
    assert.equal((await api.post('/api/commission/submit-payment', 'sellerA', { ...base, amountMinor: 5 * 13900 + 1 }))[0], 400);
    assert.equal((await api.post('/api/commission/submit-payment', 'sellerA', { ...base, amountMinor: 0 }))[0], 400);
    assert.equal((await api.post('/api/commission/submit-payment', 'sellerA', { ...base, amountMinor: 1.5 }))[0], 400);
    assert.equal((await api.post('/api/commission/submit-payment', 'sellerA', { ...base, paymentReference: 'ab' }))[0], 400);
    assert.equal((await api.post('/api/commission/submit-payment', 'sellerA', { ...base, invoiceId: 'inv-does-not-exist' }))[0], 404);
  });
});

test('only the verified Super Admin settles; approval needs explicit funds confirmation; replays and races cannot double-settle', async () => {
  const f = build();
  await serve(f.app, async api => {
    await paidOrders(f, api, 'sellerA', 5);
    const [, { invoices: [invoice] }] = await api.get('/api/commission/status', 'sellerA');
    const [, { payment }] = await api.post('/api/commission/submit-payment', 'sellerA', { invoiceId: invoice.invoiceId, paymentMethod: 'bank_transfer', paymentReference: 'COMM-REF-200' });
    const approve = { paymentId: payment.paymentId, decision: 'approve', fundsConfirmed: true };
    for (const path of ['/api/commission/verify-payment', '/api/admin/commission/verify-payment', '/api/commissions/verify-payment']) {
      assert.equal((await api.post(path, 'sellerA', approve))[0], 403, 'Seller cannot approve their own settlement ' + path);
      assert.equal((await api.post(path, 'buyerA', approve))[0], 403);
      assert.equal((await api.post(path, null, approve))[0], 401);
    }
    assert.equal((await api.post('/api/commission/verify-payment', ADMIN, { paymentId: payment.paymentId, decision: 'approve' }))[0], 400); // uploaded evidence alone never settles
    assert.equal((await api.post('/api/commission/verify-payment', ADMIN, { ...approve, fundsConfirmed: 'yes' }))[0], 400);
    assert.equal((await api.post('/api/commission/verify-payment', ADMIN, { paymentId: payment.paymentId, decision: 'maybe' }))[0], 400);
    assert.equal(f.db.data.get('commission_invoices/' + invoice.invoiceId).remainingBalanceMinor, 5 * 13900, 'nothing moved yet');

    const results = await Promise.all([api.post('/api/commission/verify-payment', ADMIN, approve), api.post('/api/admin/commission/verify-payment', ADMIN, approve)]);
    assert.deepEqual(results.map(r => r[0]).sort(), [200, 409]);
    const settled = f.db.data.get('commission_invoices/' + invoice.invoiceId);
    assert.equal(settled.status, 'paid'); assert.equal(settled.paidAmountMinor, 5 * 13900); assert.equal(settled.remainingBalanceMinor, 0);
    for (const n of invoice.orderNumbers) {
      assert.equal(f.db.data.get('ledger/' + n).commissionStatus, 'paid');
      assert.equal(f.db.data.get('commission_entries/' + n).status, 'paid');
    }
    assert.equal((await api.post('/api/commission/verify-payment', ADMIN, approve))[0], 409); // later replay
    assert.equal(f.db.data.get('commission_invoices/' + invoice.invoiceId).paidAmountMinor, 5 * 13900, 'never settled twice');
    const [, after] = await api.get('/api/commission/status', 'sellerA');
    assert.equal(after.totalPaidCommissionMinor, 5 * 13900); assert.equal(after.invoices[0].lifecycleStatus, 'settled');
    assert.equal(after.payments[0].lifecycleStatus, 'settled');
    const actions = auditActions(f.db);
    for (const a of ['COMMISSION_INVOICE_ISSUED', 'COMMISSION_PAYMENT_SUBMITTED', 'COMMISSION_PAYMENT_VERIFIED']) assert.ok(actions.includes(a), a);
    assert.equal(actions.filter(a => a === 'COMMISSION_PAYMENT_VERIFIED').length, 1, 'exactly one settlement audit entry');
  });
});

test('rejection keeps the balance, keeps the reference reserved, and allows a corrected resubmission', async () => {
  const f = build();
  await serve(f.app, async api => {
    await paidOrders(f, api, 'sellerA', 5);
    const [, { invoices: [invoice] }] = await api.get('/api/commission/status', 'sellerA');
    const send = ref => api.post('/api/commission/submit-payment', 'sellerA', { invoiceId: invoice.invoiceId, paymentMethod: 'bank_transfer', paymentReference: ref });
    const [, first] = await send('COMM-REF-300');
    const [rej, rejected] = await api.post('/api/commission/verify-payment', ADMIN, { paymentId: first.payment.paymentId, decision: 'reject', note: 'no matching credit' });
    assert.equal(rej, 200); assert.equal(rejected.payment.status, 'rejected'); assert.equal(rejected.payment.lifecycleStatus, 'rejected');
    assert.equal(rejected.invoice.remainingBalanceMinor, 5 * 13900); assert.equal(rejected.invoice.status, 'open');
    assert.equal((await send('COMM-REF-300'))[0], 409, 'a rejected reference cannot be replayed');
    assert.equal((await send('COMM-REF-301'))[0], 200);
    assert.ok(auditActions(f.db).includes('COMMISSION_PAYMENT_REJECTED'));
  });
});

test('an administrator can never settle their own commission', async () => {
  const f = build();
  await serve(f.app, async api => {
    f.db.seed('commission_invoices/inv-admin-own', { invoiceId: 'inv-admin-own', invoiceNumber: 'INV-X', sellerId: ADMIN, storeId: 'store-admin', currency: 'PKR',
      orderNumbers: ['x'], commissionAmountMinor: 500, paidAmountMinor: 0, adjustedAmountMinor: 0, remainingBalanceMinor: 500, status: 'payment_submitted', dueAtMs: Date.now() + 1e9 });
    f.db.seed('commission_payments/cpay-admin-own', { paymentId: 'cpay-admin-own', invoiceId: 'inv-admin-own', sellerId: ADMIN, storeId: 'store-admin', currency: 'PKR', amountMinor: 500, status: 'submitted' });
    const [status, body] = await api.post('/api/commission/verify-payment', ADMIN, { paymentId: 'cpay-admin-own', decision: 'approve', fundsConfirmed: true });
    assert.equal(status, 403); assert.equal(body.code, 'commission/self-review');
    assert.equal(f.db.data.get('commission_payments/cpay-admin-own').status, 'submitted');
  });
});

test('cross-seller and role isolation on commission reads', async () => {
  const f = build();
  await serve(f.app, async api => {
    await paidOrders(f, api, 'sellerA', 5);
    assert.equal((await api.get('/api/commission/status', null))[0], 401);
    assert.equal((await api.get('/api/commission/status?sellerId=sellerA', 'sellerB'))[0], 403);
    assert.equal((await api.get('/api/commission/status', 'buyerA'))[0], 403);
    const [, own] = await api.get('/api/commission/status', 'sellerB');
    assert.equal(own.invoices.length, 0, 'Seller B sees none of Seller A invoices');
    assert.equal((await api.get('/api/commission/status?sellerId=sellerA', ADMIN))[1].invoices.length, 1);
    assert.equal((await api.get('/api/commission/admin/overview', 'sellerA'))[0], 403);
    assert.equal((await api.get('/api/commission/admin-overview', null))[0], 401);
    const [ok, overview] = await api.get('/api/commission/admin/overview', ADMIN);
    assert.equal(ok, 200); assert.equal(overview.invoices.length, 1); assert.equal(overview.settings.platformCommissionBps, 500);
    assert.equal(Object.hasOwn(overview, 'stores'), false, 'no invented store telemetry');
  });
});

test('refund reduces an unpaid invoice atomically and a replay cannot reduce it twice', async () => {
  const f = build();
  await serve(f.app, async api => {
    const orders = await paidOrders(f, api, 'sellerA', 5);
    const [, { invoices: [invoice] }] = await api.get('/api/commission/status', 'sellerA');
    const refund = { orderNumber: orders[0].orderNumber, refundConfirmed: true, refundReference: 'REFUND-001' };
    assert.equal((await api.post('/api/orders/refund', 'sellerB', refund))[0], 403);
    assert.equal((await api.post('/api/orders/refund', 'sellerA', refund))[0], 200);
    const updated = f.db.data.get('commission_invoices/' + invoice.invoiceId);
    assert.equal(updated.remainingBalanceMinor, 4 * 13900); assert.equal(updated.adjustedAmountMinor, 13900);
    const adjustments = [...f.db.data].filter(([k, v]) => k.startsWith('commission_adjustments/') && v.invoiceId === invoice.invoiceId);
    assert.equal(adjustments.length, 1); assert.equal(adjustments[0][1].creditDueMinor, 0);
    assert.equal(f.db.data.get('ledger/' + orders[0].orderNumber).paymentStatus, 'Refunded');
    assert.equal((await api.post('/api/orders/refund', 'sellerA', refund))[0], 409);
    assert.equal(f.db.data.get('commission_invoices/' + invoice.invoiceId).remainingBalanceMinor, 4 * 13900);
  });
});

test('a refund after the commission was already settled records an auditable credit instead of losing it', async () => {
  const f = build();
  await serve(f.app, async api => {
    const orders = await paidOrders(f, api, 'sellerA', 5);
    const [, { invoices: [invoice] }] = await api.get('/api/commission/status', 'sellerA');
    const [, { payment }] = await api.post('/api/commission/submit-payment', 'sellerA', { invoiceId: invoice.invoiceId, paymentMethod: 'bank_transfer', paymentReference: 'COMM-REF-400' });
    assert.equal((await api.post('/api/commission/verify-payment', ADMIN, { paymentId: payment.paymentId, decision: 'approve', fundsConfirmed: true }))[0], 200);
    assert.equal((await api.post('/api/orders/refund', 'sellerA', { orderNumber: orders[1].orderNumber, refundConfirmed: true, refundReference: 'REFUND-002' }))[0], 200);
    const inv = f.db.data.get('commission_invoices/' + invoice.invoiceId);
    assert.equal(inv.status, 'paid'); assert.equal(inv.remainingBalanceMinor, 0); assert.equal(inv.paidAmountMinor, 5 * 13900, 'history is never rewritten');
    const adj = [...f.db.data.values()].find(v => v.invoiceId === invoice.invoiceId && v.reason === 'order_refunded');
    assert.equal(adj.creditDueMinor, 13900);
  });
});

test('a refund that cannot be reconciled with its invoice changes nothing', async () => {
  const f = build();
  await serve(f.app, async api => {
    const orders = await paidOrders(f, api, 'sellerA', 5);
    const [, { invoices: [invoice] }] = await api.get('/api/commission/status', 'sellerA');
    f.db.data.delete('commission_invoices/' + invoice.invoiceId); // simulate corrupt/missing billing record
    const [status, body] = await api.post('/api/orders/refund', 'sellerA', { orderNumber: orders[2].orderNumber, refundConfirmed: true, refundReference: 'REFUND-003' });
    assert.equal(status, 409); assert.equal(body.code, 'orders/refund-reconcile-failed');
    assert.equal(f.db.data.get('ledger/' + orders[2].orderNumber).paymentStatus, 'Paid');
  });
});

test('seller attestation is recorded as an attestation, never as bank or gateway verification', async () => {
  const f = build();
  await serve(f.app, async api => {
    const input = orderInput('sellerA'); await f.finance.createOrder(input);
    assert.equal((await api.post('/api/orders/verify-payment', 'sellerA', verifyBody(input, { receivedAmountMinor: 1 })))[1].code, 'orders/amount-mismatch');
    assert.equal((await api.post('/api/orders/verify-payment', 'sellerA', verifyBody(input, { evidenceType: 'psychic' })))[0], 422);
    assert.equal(f.db.data.get('ledger/' + input.orderNumber).paymentStatus, 'Pending', 'rejected attempts change nothing');
    assert.equal((await api.post('/api/orders/verify-payment', 'sellerA', { orderNumber: input.orderNumber, newStatus: 'Paid' }))[0], 422);
    assert.equal((await api.post('/api/orders/verify-payment', 'buyerA', verifyBody(input)))[0], 403);
    assert.equal((await api.post('/api/orders/verify-payment', 'sellerB', verifyBody(input)))[0], 403);
    const [status, body] = await api.post('/api/orders/verify-payment', 'sellerA',
      verifyBody(input, { evidenceType: 'bank_statement', receivedAmountMinor: 278000, evidenceNote: 'ACCOUNT 1234-SECRET' }));
    assert.equal(status, 200);
    assert.equal(body.verificationMode, 'Manually Verified by Seller');
    const saved = f.db.data.get('ledger/' + input.orderNumber);
    assert.equal(saved.attestation.statement, 'seller_manual_attestation_v1');
    assert.equal(saved.attestation.evidenceType, 'bank_statement');
    assert.equal(saved.attestation.attestedByUid, 'sellerA');
    assert.equal(saved.attestation.receivedAmountMinor, 278000);
    assert.equal(saved.attestation.evidenceNoteProvided, true);
    assert.equal(JSON.stringify([...f.db.data.values()]).includes('1234-SECRET'), false, 'free-text evidence notes are never persisted');
    assert.ok(!/bank verified|gateway verified/i.test(saved.verificationMode));
    const audit = [...f.db.data.values()].find(v => v.action === 'MANUAL_PAYMENT_VERIFIED');
    assert.equal(audit.actorUid, 'sellerA'); assert.equal(audit.attestation.evidenceType, 'bank_statement');
    assert.equal((await api.post('/api/orders/verify-payment', 'sellerA', verifyBody(input)))[0], 409, 'already-paid orders cannot be paid again');
  });
});

test('concurrent seller approvals create exactly one commission entry and one audit record', async () => {
  const f = build();
  await serve(f.app, async api => {
    const input = orderInput('sellerA'); await f.finance.createOrder(input);
    const results = await Promise.all(Array.from({ length: 5 }, () => api.post('/api/orders/verify-payment', 'sellerA', verifyBody(input))));
    assert.deepEqual(results.map(r => r[0]).sort(), [200, 409, 409, 409, 409]);
    assert.equal([...f.db.data.keys()].filter(k => k.startsWith('commission_entries/')).length, 1);
    assert.equal(auditActions(f.db).filter(a => a === 'MANUAL_PAYMENT_VERIFIED').length, 1);
  });
});

test('reusing an idempotency key with different purchase details is denied; a true replay returns the saved order', async () => {
  const f = build();
  await serve(f.app, async api => {
    const checkout = (extra = {}) => api.post('/api/checkout/validate-and-prepare', 'buyerA', { idempotencyKey: 'checkout-key-0001', storeId: 'store-sellerA',
      items: [{ id: 'bookA', quantity: 1 }], currency: 'PKR', paymentMethod: 'jazzcash', paymentReference: 'TXN-REPLAY-1', ...extra });
    const [created, first] = await checkout();
    assert.equal(created, 201, JSON.stringify(first));
    const [replayStatus, replay] = await checkout();
    assert.equal(replayStatus, 200); assert.equal(replay.duplicate, true); assert.equal(replay.orderNumber, first.orderNumber);
    assert.equal(replay.downloadToken, 'LOCKED-PENDING-VERIFICATION');
    const [conflict, body] = await checkout({ currency: 'USD', paymentReference: 'TXN-REPLAY-1' });
    assert.equal(conflict, 409); assert.equal(body.code, 'checkout/idempotency-conflict');
    assert.equal((await checkout({ paymentReference: 'TXN-OTHER-9' }))[1].code, 'checkout/idempotency-conflict');
    assert.equal((await checkout({ items: [{ id: 'bookB', quantity: 1 }], storeId: 'store-sellerB' }))[1].code, 'checkout/idempotency-conflict');
    assert.equal([...f.db.data.keys()].filter(k => k.startsWith('ledger/')).length, 1, 'only the original order exists');
    // A different buyer reusing the same key text is a different idempotency scope, not a replay.
    assert.equal((await api.post('/api/checkout/validate-and-prepare', 'buyerB', { idempotencyKey: 'checkout-key-0001', storeId: 'store-sellerA',
      items: [{ id: 'bookA', quantity: 1 }], currency: 'PKR', paymentMethod: 'jazzcash', paymentReference: 'TXN-BUYERB-1' }))[0], 201);
  });
});

test('webhooks stay disabled and never acknowledge an event; gateways report not configured', async () => {
  const f = build();
  await serve(f.app, async api => {
    for (const provider of ['stripe', 'razorpay', 'jazzcash']) {
      const [status, body] = await api.post('/api/webhooks/' + provider, null, { event: 'payment.succeeded', amount: 999999 });
      assert.equal(status, 503); assert.equal(body.code, 'webhooks/disabled');
    }
    const [status, gw] = await api.get('/api/payments/gateway-status');
    assert.equal(status, 200); assert.equal(gw.stripeConfigured, false); assert.equal(gw.razorpayConfigured, false);
    assert.equal(gw.platformCommissionBps, 500);
    assert.equal([...f.db.data.keys()].filter(k => k.startsWith('ledger/')).length, 0);
  });
});

test('commission writes are refused outside isolated staging', async () => {
  const f = build({ allowWrites: false });
  await serve(f.app, async api => {
    assert.equal((await api.post('/api/commission/submit-payment', 'sellerA', { invoiceId: 'inv-abc', paymentReference: 'REF-1', paymentMethod: 'bank' }))[0], 503);
    assert.equal((await api.post('/api/commission/verify-payment', ADMIN, { paymentId: 'cpay-abc', decision: 'reject' }))[0], 503);
  });
});
