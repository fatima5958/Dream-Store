import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { CommissionRepository } from '../contracts.ts';
import { ApiError } from '../errors.ts';
import {
  INVOICE_PAYMENT_WINDOW_MS, INVOICE_SALES_THRESHOLD, RESTRICTED_FEATURES_ON_OVERDUE,
  UNRESTRICTED_FEATURES_ALWAYS, invoiceLifecycle, paymentLifecycle,
} from './commission-lifecycle.ts';

type Row = Record<string, any>;
const ELIGIBLE_MODES = new Set(['Manually Verified by Seller', 'Gateway Verified']);

/** An order contributes billable commission only after a recorded verification and never once reversed/disputed. */
export function isBillable(entry: Row | null | undefined): boolean {
  return Boolean(entry && entry.paymentStatus === 'Paid' && Number(entry.grossAmountMinor) > 0 &&
    Number.isSafeInteger(entry.platformCommissionMinor) && entry.platformCommissionMinor >= 0 &&
    ELIGIBLE_MODES.has(entry.verificationMode) &&
    entry.commissionStatus !== 'reversed' && entry.commissionStatus !== 'disputed');
}

function signInvoice(secret: string, p: { invoiceId: string; sellerId: string; orderNumbers: string[]; commissionAmountMinor: number; dueAtMs: number }) {
  // Same canonical string as V1 so records stay interchangeable (V1 never verifies it on read).
  return createHmac('sha256', secret).update(
    `inv:${p.invoiceId}:${p.sellerId}:${p.orderNumbers.join(',')}:${p.commissionAmountMinor}:${p.dueAtMs}`).digest('hex');
}

export function adjustmentIdFor(invoiceId: string, orderNumber: string): string {
  return 'adj-' + createHash('sha256').update(invoiceId + ':' + orderNumber + ':refund').digest('hex').slice(0, 32);
}

export function createFirestoreCommissionRepository(db: Firestore, options: { signingSecret: string }): CommissionRepository {
  const requireSecret = () => {
    if (options.signingSecret.length < 32) throw new ApiError(503, 'commission/signing-unavailable', 'Commission signing is not configured.');
  };
  const audit = (tx: any, entry: Row) => {
    const auditId = `aud-${randomUUID()}`;
    // create() only: an existing audit row can never be overwritten.
    tx.create(db.collection('ledger_audit').doc(auditId), { auditId, createdAtIso: new Date().toISOString(), entity: 'commission', ...entry });
  };

  async function issueInvoices(sellerId: string): Promise<number> {
    requireSecret();
    const rows = await db.collection('ledger').where('sellerId', '==', sellerId).get();
    const groups = new Map<string, Array<{ orderNumber: string; entry: Row }>>();
    for (const row of rows.docs) {
      const entry = row.data() as Row;
      if (entry.orderNumber !== row.id || entry.invoiceId || !isBillable(entry)) continue;
      const list = groups.get(entry.currency) || [];
      list.push({ orderNumber: row.id, entry });
      groups.set(entry.currency, list);
    }
    let issued = 0;
    for (const [currency, orders] of groups) {
      orders.sort((a, b) => String(a.entry.createdAtIso).localeCompare(String(b.entry.createdAtIso)) || a.orderNumber.localeCompare(b.orderNumber));
      for (let start = 0; start + INVOICE_SALES_THRESHOLD <= orders.length; start += INVOICE_SALES_THRESHOLD) {
        const numbers = orders.slice(start, start + INVOICE_SALES_THRESHOLD).map(row => row.orderNumber);
        // Deterministic id: replays and concurrent issuers converge on the same document.
        const hash = createHash('sha256').update([sellerId, currency, ...numbers].join(':')).digest('hex');
        const invoiceId = 'inv-' + hash.slice(0, 28);
        const invoiceRef = db.collection('commission_invoices').doc(invoiceId);
        const made = await db.runTransaction(async (tx: any) => {
          const refs = numbers.map(number => db.collection('ledger').doc(number));
          const [already, ...latest] = await Promise.all([tx.get(invoiceRef), ...refs.map((ref: any) => tx.get(ref))]);
          if (already.exists) return null;
          const maybe = latest.map((snap: any) => (snap.exists ? snap.data() as Row : null));
          if (maybe.some((e: Row | null) => !e || e.sellerId !== sellerId || e.currency !== currency || e.invoiceId || !isBillable(e))) return null;
          const fresh = maybe as Row[]; // every entry verified non-null above
          const grossSalesMinor = fresh.reduce((sum: number, e: Row) => sum + Number(e.grossAmountMinor), 0);
          const feeMinor = fresh.reduce((sum: number, e: Row) => sum + Number(e.platformCommissionMinor), 0);
          if (!Number.isSafeInteger(grossSalesMinor) || !Number.isSafeInteger(feeMinor) || feeMinor < 0) {
            throw new ApiError(503, 'commission/invalid-calculation', 'Invoice calculation failed safely.');
          }
          const nowMs = Date.now(); const dueAtMs = nowMs + INVOICE_PAYMENT_WINDOW_MS;
          const invoice = { invoiceId, invoiceNumber: 'INV-' + new Date(nowMs).getFullYear() + '-' + hash.slice(0, 8).toUpperCase(),
            sellerId, storeId: String(fresh[0].storeId), currency, orderNumbers: numbers, verifiedSalesCount: numbers.length,
            grossSalesMinor, commissionAmountMinor: feeMinor, paidAmountMinor: 0, adjustedAmountMinor: 0, remainingBalanceMinor: feeMinor,
            status: 'open', issuedAtMs: nowMs, dueAtMs, issuedAtIso: new Date(nowMs).toISOString(), dueAtIso: new Date(dueAtMs).toISOString(),
            serverSignature: signInvoice(options.signingSecret, { invoiceId, sellerId, orderNumbers: numbers, commissionAmountMinor: feeMinor, dueAtMs }) };
          tx.create(invoiceRef, invoice);
          for (const ref of refs) tx.update(ref, { invoiceId });
          audit(tx, { orderNumber: invoice.invoiceNumber, orderId: invoiceId, sellerId, actorUid: 'system', action: 'COMMISSION_INVOICE_ISSUED',
            previousStatus: 'none', newStatus: 'open', detail: `${numbers.length} verified sales, ${feeMinor} minor units ${currency}` });
          return invoice;
        });
        if (made) issued++;
      }
    }
    return issued;
  }

  async function summary(sellerId: string, nowMs = Date.now()): Promise<Row> {
    const [ledgerRows, invoiceRows, paymentRows, adjustmentRows] = await Promise.all([
      db.collection('ledger').where('sellerId', '==', sellerId).get(),
      db.collection('commission_invoices').where('sellerId', '==', sellerId).get(),
      db.collection('commission_payments').where('sellerId', '==', sellerId).get(),
      db.collection('commission_adjustments').where('sellerId', '==', sellerId).get(),
    ]);
    const entries = ledgerRows.docs.map((d: any) => d.data() as Row);
    const eligible = entries.filter(e => isBillable(e));
    const unbilled = eligible.filter(e => !e.invoiceId);
    const payments = paymentRows.docs.map((d: any) => ({ ...d.data(), lifecycleStatus: paymentLifecycle(String(d.get('status'))) } as Row))
      .sort((a: Row, b: Row) => String(b.createdAtIso).localeCompare(String(a.createdAtIso)));
    const adjustments = adjustmentRows.docs.map((d: any) => d.data() as Row)
      .filter((a: Row) => a.invoiceId).sort((a: Row, b: Row) => String(b.createdAtIso).localeCompare(String(a.createdAtIso)));
    const invoices = invoiceRows.docs.map((d: any) => ({ ...(d.data() as Row) })).sort((a: Row, b: Row) => b.issuedAtMs - a.issuedAtMs);
    let isRestricted = false; let restrictionReason: string | null = null; let earliest: number | null = null;
    for (const inv of invoices) {
      if (inv.remainingBalanceMinor <= 0) {
        if (inv.status !== 'paid' && inv.status !== 'voided') inv.status = inv.paidAmountMinor > 0 ? 'paid' : 'voided'; // display only
      } else {
        if (earliest === null || inv.dueAtMs < earliest) earliest = inv.dueAtMs;
        if (nowMs > inv.dueAtMs) {
          const awaitingReview = payments.some((p: Row) => p.invoiceId === inv.invoiceId && p.status === 'submitted');
          if (!awaitingReview) {
            if (inv.status === 'open') inv.status = 'overdue';
            isRestricted = true;
            restrictionReason ||= `Commission invoice ${inv.invoiceNumber} (${(inv.remainingBalanceMinor / 100).toFixed(2)} ${inv.currency}) is past its 7-day payment deadline. Adding/publishing products, Visual Store Builder, and theme customization are paused until settlement. Public storefront, buyer checkout, and existing downloads remain active.`;
          }
        } else if (inv.status === 'overdue') inv.status = 'open';
      }
      inv.lifecycleStatus = invoiceLifecycle(inv.status, inv.remainingBalanceMinor, inv.paidAmountMinor);
    }
    const unbilledCommissionMinor = unbilled.reduce((s, e) => s + Number(e.platformCommissionMinor), 0);
    const invoicedOutstandingMinor = invoices.filter((i: Row) => i.status !== 'paid' && i.status !== 'voided').reduce((s: number, i: Row) => s + i.remainingBalanceMinor, 0);
    return { sellerId, storeId: invoices[0]?.storeId || entries[0]?.storeId || '', currency: invoices[0]?.currency || entries[0]?.currency || 'PKR',
      salesTowardNextInvoice: unbilled.length, invoiceThreshold: INVOICE_SALES_THRESHOLD, totalVerifiedEligibleSales: eligible.length,
      unbilledOrderNumbers: unbilled.map(e => e.orderNumber), unbilledCommissionMinor, invoicedOutstandingMinor,
      totalOutstandingCommissionMinor: unbilledCommissionMinor + invoicedOutstandingMinor,
      totalPaidCommissionMinor: invoices.reduce((s: number, i: Row) => s + i.paidAmountMinor, 0),
      totalAdjustedCommissionMinor: invoices.reduce((s: number, i: Row) => s + i.adjustedAmountMinor, 0),
      nextPaymentDeadlineMs: earliest, nextPaymentDeadlineIso: earliest === null ? null : new Date(earliest).toISOString(),
      daysUntilDeadline: earliest === null ? null : Math.ceil((earliest - nowMs) / 86400000),
      isRestricted, restrictionReason, restrictedFeatures: isRestricted ? RESTRICTED_FEATURES_ON_OVERDUE : [],
      unrestrictedFeatures: UNRESTRICTED_FEATURES_ALWAYS, invoices, payments, adjustments };
  }

  return {
    issueInvoices,
    summary,

    async submitPayment(input) {
      const reference = input.reference.trim().toUpperCase();
      const referenceKey = createHash('sha256').update(reference).digest('hex');
      const paymentId = `cpay-${randomUUID()}`;
      const invoiceRef = db.collection('commission_invoices').doc(input.invoiceId);
      const paymentRef = db.collection('commission_payments').doc(paymentId);
      const reservationRef = db.collection('commission_payment_refs').doc(referenceKey);
      return db.runTransaction(async (tx: any) => {
        const [invoiceSnap, existingRef, sameInvoice] = await Promise.all([
          tx.get(invoiceRef), tx.get(reservationRef),
          tx.get(db.collection('commission_payments').where('invoiceId', '==', input.invoiceId)),
        ]);
        if (!invoiceSnap.exists) throw new ApiError(404, 'commission/invoice-not-found', 'Commission invoice not found.');
        const invoice = invoiceSnap.data() as Row;
        // Only the owning Seller may attach evidence. Administrators review; they never submit for a Seller.
        if (invoice.sellerId !== input.sellerUid) throw new ApiError(403, 'commission/forbidden', 'Invoice belongs to another seller.');
        if (existingRef.exists) throw new ApiError(409, 'commission/duplicate-reference', 'Transfer reference already submitted.');
        if (invoice.status === 'paid' || Number(invoice.remainingBalanceMinor) <= 0) throw new ApiError(409, 'commission/already-settled', 'Commission invoice already settled.');
        if (sameInvoice.docs.some((d: any) => d.get('status') === 'submitted')) {
          throw new ApiError(409, 'commission/proof-pending', 'A payment proof for this invoice is already awaiting Super Admin review.');
        }
        const remainder = Number(invoice.remainingBalanceMinor);
        const requested = input.amountMinor === undefined ? remainder : Number(input.amountMinor);
        if (!Number.isSafeInteger(requested) || requested <= 0 || requested > remainder) {
          throw new ApiError(400, 'commission/invalid-amount', 'Transfer amount must be positive and at most the remaining balance.');
        }
        const nowIso = new Date().toISOString();
        const payment = { paymentId, invoiceId: input.invoiceId, invoiceNumber: invoice.invoiceNumber, sellerId: invoice.sellerId, storeId: invoice.storeId,
          currency: invoice.currency, amountMinor: requested, paymentMethod: input.method, paymentReference: reference,
          proofNote: input.proofNote.slice(0, 500), status: 'submitted', submittedByUid: input.sellerUid,
          lifecycleStatus: 'proof_submitted', evidenceKind: 'seller_declared_transfer_reference', createdAtIso: nowIso, updatedAtIso: nowIso };
        tx.create(paymentRef, payment);
        tx.create(reservationRef, { paymentId, invoiceId: input.invoiceId, sellerId: invoice.sellerId, createdAtIso: nowIso });
        tx.update(invoiceRef, { status: 'payment_submitted', lastPaymentMethod: input.method, lastPaymentReference: reference,
          lastPaymentProofNote: payment.proofNote, submittedAtIso: nowIso });
        audit(tx, { orderNumber: invoice.invoiceNumber, orderId: input.invoiceId, sellerId: invoice.sellerId, actorUid: input.sellerUid,
          action: 'COMMISSION_PAYMENT_SUBMITTED', previousStatus: invoice.status, newStatus: 'payment_submitted',
          detail: 'Seller-declared transfer reference. Not verified until a Super Admin reviews it.' });
        return { payment, invoice: { ...invoice, status: 'payment_submitted', submittedAtIso: nowIso } };
      });
    },

    async reviewPayment(input) {
      const paymentRef = db.collection('commission_payments').doc(input.paymentId);
      return db.runTransaction(async (tx: any) => {
        const paymentSnap = await tx.get(paymentRef);
        if (!paymentSnap.exists) throw new ApiError(404, 'commission/not-found', 'Submitted payment or invoice not found.');
        const payment = paymentSnap.data() as Row;
        // A replayed or concurrent decision always lands here: only a 'submitted' proof can be decided, once.
        if (payment.status !== 'submitted') throw new ApiError(409, 'commission/already-reviewed', 'Payment has already been reviewed or does not match the invoice.');
        if (input.invoiceId && input.invoiceId !== payment.invoiceId) throw new ApiError(409, 'commission/invoice-mismatch', 'Payment has already been reviewed or does not match the invoice.');
        const invoiceRef = db.collection('commission_invoices').doc(payment.invoiceId);
        const invoiceSnap = await tx.get(invoiceRef);
        if (!invoiceSnap.exists) throw new ApiError(404, 'commission/not-found', 'Submitted payment or invoice not found.');
        const invoice = invoiceSnap.data() as Row;
        if (invoice.sellerId !== payment.sellerId || invoice.currency !== payment.currency || invoice.storeId !== payment.storeId) {
          throw new ApiError(409, 'commission/invoice-mismatch', 'Financial record ownership mismatch.');
        }
        // An administrator who is also the invoiced Seller can never settle their own commission.
        if (invoice.sellerId === input.adminUid) throw new ApiError(403, 'commission/self-review', 'You cannot review your own commission payment.');
        const credit = Number(payment.amountMinor); const available = Number(invoice.remainingBalanceMinor);
        if (!Number.isSafeInteger(credit) || credit <= 0 || !Number.isSafeInteger(available) || available < credit || invoice.status === 'paid') {
          throw new ApiError(409, 'commission/already-reviewed', 'Invalid or already settled amount.');
        }
        const approve = input.decision === 'approve';
        const remaining = approve ? available - credit : available;
        const paid = approve ? invoice.paidAmountMinor + credit : invoice.paidAmountMinor;
        const status = approve && remaining === 0 ? 'paid' : Date.now() > invoice.dueAtMs ? 'overdue' : 'open';
        const settledOrders: string[] = approve && remaining === 0 ? invoice.orderNumbers : [];
        const ledgerRefs = settledOrders.map(n => db.collection('ledger').doc(n));
        const entryRefs = settledOrders.map(n => db.collection('commission_entries').doc(n));
        const reads = await Promise.all([...ledgerRefs, ...entryRefs].map(ref => tx.get(ref)));
        const nowIso = new Date().toISOString();
        tx.update(paymentRef, { status: approve ? 'verified' : 'rejected', lifecycleStatus: approve ? 'settled' : 'rejected',
          verifiedByAdminEmail: input.adminEmail, reviewedByUid: input.adminUid, reviewNote: input.note.slice(0, 200), updatedAtIso: nowIso });
        tx.update(invoiceRef, { status, paidAmountMinor: paid, remainingBalanceMinor: remaining,
          ...(approve ? { verifiedByAdminEmail: input.adminEmail, verifiedAtIso: nowIso } : {}) });
        ledgerRefs.forEach((ref, i) => {
          const snap = reads[i];
          if (snap.exists && snap.get('sellerId') === invoice.sellerId && snap.get('invoiceId') === invoice.invoiceId && snap.get('commissionStatus') === 'outstanding') {
            tx.update(ref, { commissionStatus: 'paid', updatedAtIso: nowIso });
          }
        });
        entryRefs.forEach((ref, i) => {
          const snap = reads[ledgerRefs.length + i];
          if (snap.exists && snap.get('status') === 'outstanding') tx.update(ref, { status: 'paid', paidAtIso: nowIso, updatedAtIso: nowIso });
        });
        audit(tx, { orderNumber: invoice.invoiceNumber, orderId: invoice.invoiceId, sellerId: invoice.sellerId, actorUid: input.adminUid,
          action: approve ? 'COMMISSION_PAYMENT_VERIFIED' : 'COMMISSION_PAYMENT_REJECTED', previousStatus: 'payment_submitted', newStatus: status,
          detail: `Admin reviewed ${input.paymentId}; funds confirmed on external statement: ${approve ? 'yes' : 'n/a'}.` });
        return { payment: { ...payment, status: approve ? 'verified' : 'rejected', lifecycleStatus: approve ? 'settled' : 'rejected', reviewedByUid: input.adminUid, updatedAtIso: nowIso },
          invoice: { ...invoice, status, paidAmountMinor: paid, remainingBalanceMinor: remaining } };
      });
    },

    async adminOverview() {
      const [invoices, payments, adjustments] = await Promise.all([
        db.collection('commission_invoices').limit(500).get(),
        db.collection('commission_payments').limit(500).get(),
        db.collection('commission_adjustments').limit(500).get(),
      ]);
      const inv = invoices.docs.map((d: any) => ({ ...d.data(), lifecycleStatus: invoiceLifecycle(String(d.get('status')), Number(d.get('remainingBalanceMinor')), Number(d.get('paidAmountMinor'))) }) as Row)
        .sort((a: Row, b: Row) => b.issuedAtMs - a.issuedAtMs);
      const pay = payments.docs.map((d: any) => ({ ...d.data(), lifecycleStatus: paymentLifecycle(String(d.get('status'))) }) as Row)
        .sort((a: Row, b: Row) => String(b.createdAtIso).localeCompare(String(a.createdAtIso)));
      return { settings: { platformCommissionBps: 500, maintenanceMode: false, allowNewSellerRegistrations: true, updatedAtIso: new Date().toISOString() },
        invoices: inv, payments: pay, adjustments: adjustments.docs.map((d: any) => d.data() as Row) };
    },
  };
}
