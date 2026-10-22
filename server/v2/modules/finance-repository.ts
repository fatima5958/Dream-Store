import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { assertStorageBinding, type StorageBucket } from '../storage/contracts.ts';
import type { FinancialRepository } from '../contracts.ts';
import { ApiError } from '../errors.ts';
import { commissionBreakdown, commissionEntry } from './commissions.ts';
import { validateFileBytes } from './uploads.ts';
import { canDownload } from './download-policy.ts';

const COMMISSION_INVOICE_THRESHOLD = 5;
const COMMISSION_INVOICE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function createFirestoreFinancialRepository(
  db: Firestore,
  bucket: StorageBucket,
  invoiceSigningSecret = String(process.env.SERVER_SIGNING_SECRET || process.env.DOWNLOAD_SIGNING_SECRET || process.env.TOKEN_SIGNING_SECRET || ''),
): FinancialRepository {
  const ledger = db.collection('ledger'); const orders = db.collection('orders');
  return {
    async store(target) {
      const direct = await db.collection('stores').doc(target).get();
      if (direct.exists) return { ...direct.data(), storeId: direct.id };
      const byOwner = await db.collection('stores').where('ownerId', '==', target).limit(2).get();
      if (byOwner.docs.length > 1) throw new ApiError(409, 'store/multiple-owned', 'Multiple owned stores require administrator review.');
      if (byOwner.docs[0]) return { ...byOwner.docs[0].data(), storeId: byOwner.docs[0].id };
      const bySlug = await db.collection('stores').where('storeSlug', '==', target.toLowerCase()).limit(2).get();
      if (bySlug.docs.length > 1) throw new ApiError(409, 'store/ambiguous-slug', 'Store URL requires administrator review.');
      return bySlug.docs[0] ? { ...bySlug.docs[0].data(), storeId: bySlug.docs[0].id } : null;
    },
    async paymentSettings(ownerId) {
      const ref = db.collection('sellerSettings').doc(ownerId);
      const snap = await ref.get();
      if (!snap.exists) {
        const legacy = await db.collection('users').doc(ownerId).collection('private').doc('settings').get();
        return legacy.exists ? legacy.data() || null : null;
      }
      const data = snap.data() || {};
      return data.ownerId === ownerId ? data : null;
    },
    async savePaymentSettings(ownerId, storeId, settings) {
      const ownerStore = db.collection('stores').doc(storeId);
      return db.runTransaction(async tx => {
        const store = await tx.get(ownerStore);
        if (!store.exists || store.get('ownerId') !== ownerId || store.get('status') !== 'Active') throw new ApiError(403, 'payment-settings/owner-forbidden', 'Store ownership or status changed.');
        const now = new Date();
        const record = { ...settings, ownerId, storeId, updatedAtIso: now.toISOString(), updatedAt: now };
        tx.set(db.collection('sellerSettings').doc(ownerId), record, { merge: true });
        tx.set(db.collection('users').doc(ownerId).collection('private').doc('settings'), record, { merge: true });
        return record;
      });
    },
    async createOrder(input) {
      const idem = createHash('sha256').update(`${input.buyerId}:${input.idempotencyKey}`).digest('hex');
      const requestHash = createHash('sha256').update(JSON.stringify({
        buyerId: input.buyerId, sellerId: input.sellerId, storeId: input.storeId,
        primaryProductId: input.primaryProductId, currency: input.currency,
        grossAmountMinor: input.grossAmountMinor, paymentMethod: input.paymentMethod,
        paymentReference: String(input.paymentReference || '').trim().toUpperCase(),
        customerName: String(input.customerName || ''), customerEmail: String(input.customerEmail || '').trim().toLowerCase(),
        itemTitlesSummary: String(input.itemTitlesSummary || ''), itemCount: Number(input.itemCount || 1),
      })).digest('hex');
      const idemRef = db.collection('checkout_idempotency').doc(idem);
      const ledgerRef = ledger.doc(input.orderNumber); const orderRef = orders.doc(input.orderId);
      const referenceKey = input.grossAmountMinor > 0 ? createHash('sha256').update(`${input.sellerId}:${input.paymentMethod}:${String(input.paymentReference).trim().toUpperCase()}`).digest('hex') : '';
      const paymentRef = referenceKey ? db.collection('payment_reference_claims').doc(referenceKey) : null;
      return db.runTransaction(async tx => {
        const prior = await tx.get(idemRef);
        if (prior.exists) {
          const savedNumber = String(prior.get('orderNumber') || '');
          const saved = await tx.get(ledger.doc(savedNumber));
          if (!saved.exists) throw new ApiError(503, 'orders/idempotency-corrupt', 'Existing checkout key points to an unavailable order.');
          const savedOrder = saved.data() || {};
          const legacyIntentMatches = savedOrder.buyerId === input.buyerId && savedOrder.sellerId === input.sellerId &&
            savedOrder.storeId === input.storeId && savedOrder.primaryProductId === input.primaryProductId &&
            savedOrder.currency === input.currency && Number(savedOrder.grossAmountMinor) === Number(input.grossAmountMinor) &&
            savedOrder.paymentMethod === input.paymentMethod && String(savedOrder.paymentReference || '').trim().toUpperCase() ===
              String(input.paymentReference || '').trim().toUpperCase() && String(savedOrder.customerName || '') === String(input.customerName || '') &&
            String(savedOrder.customerEmail || '').trim().toLowerCase() === String(input.customerEmail || '').trim().toLowerCase() &&
            String(savedOrder.itemTitlesSummary || '') === String(input.itemTitlesSummary || '') && Number(savedOrder.itemCount || 1) === Number(input.itemCount || 1);
          if ((prior.get('requestHash') && prior.get('requestHash') !== requestHash) || (!prior.get('requestHash') && !legacyIntentMatches)) {
            throw new ApiError(409, 'orders/idempotency-conflict', 'This checkout key was already used for different purchase details. Start a new checkout.');
          }
          return { duplicate: true, order: saved.data() || {} };
        }
        const [store, product, settings, legacySettings, priorReference] = await Promise.all([
          tx.get(db.collection('stores').doc(input.storeId)),
          tx.get(db.collection('products').doc(input.primaryProductId)),
          tx.get(db.collection('sellerSettings').doc(input.sellerId)),
          tx.get(db.collection('users').doc(input.sellerId).collection('private').doc('settings')),
          paymentRef ? tx.get(paymentRef) : Promise.resolve(null),
        ]);
        if (priorReference?.exists) throw new ApiError(409, 'checkout/duplicate-payment-reference', 'This payment reference has already been submitted for this Seller and method.');
        if (!store.exists || store.get('status') !== 'Active' || store.get('ownerId') !== input.sellerId ||
            !product.exists || product.get('deleted') === true || product.get('published') !== true ||
            product.get('status') !== 'Available' || product.get('storeId') !== input.storeId ||
            product.get('ownerId') !== input.sellerId || (product.get('isFree') === true) !== (input.grossAmountMinor === 0)) {
          throw new ApiError(409, 'checkout/catalog-changed', 'Product or store changed during checkout. Refresh and retry.');
        }
        const expected = input.currency === 'PKR' ? Number(product.get('pricePkr')) : Number(product.get('priceUsd'));
        if (input.grossAmountMinor > 0 && !Number.isFinite(expected)) throw new ApiError(409, 'checkout/price-invalid', 'Product price is unavailable.');
        const rates: Record<string, number> = { USD: 1, PKR: 278, INR: 84, GBP: .78, EUR: .92, AED: 3.67, SAR: 3.75, CAD: 1.38, AUD: 1.52 };
        const authoritativeAmount = input.currency === 'PKR' ? Number(product.get('pricePkr')) : Number(product.get('priceUsd')) * rates[input.currency];
        if (input.grossAmountMinor !== Math.round(authoritativeAmount * 100)) throw new ApiError(409, 'checkout/price-changed', 'Product price changed during checkout. Refresh and retry.');
        if (input.grossAmountMinor > 0) {
          const s = settings.data() || legacySettings.data() || {};
          const supported = (input.paymentMethod === 'jazzcash' && s.jazzCashEnabled !== false && String(s.jazzCashMerchantId || '').trim().length >= 3) ||
            (input.paymentMethod === 'easypaisa' && s.easypaisaEnabled !== false && String(s.easypaisaStoreId || '').trim().length >= 3) ||
            (input.paymentMethod === 'upi_india' && /^[\w.+-]+@[\w.-]+$/.test(String(s.upiId || '').trim())) ||
            (input.paymentMethod === 'manual_bank' && String(s.bankTransferInstructions || '').trim().length >= 5) ||
            (input.paymentMethod === 'payoneer' && s.payoneerEnabled === true && Boolean(s.payoneerReceivingEmail || s.payoneerRequestLink || s.payoneerReceivingAccountDetails));
          if ((!settings.exists && !legacySettings.exists) || s.ownerId !== input.sellerId || !supported) throw new ApiError(409, 'checkout/payment-settings-changed', 'Seller payment instructions changed during checkout.');
        }
        tx.create(ledgerRef, input);
        tx.create(orderRef, { orderNumber: input.orderNumber, orderId: input.orderId, storeId: input.storeId,
          sellerId: input.sellerId, buyerId: input.buyerId, primaryProductId: input.primaryProductId,
          customerName: input.customerName, customerEmail: input.customerEmail, currency: input.currency,
          subtotal: input.subtotal, totalAmount: input.totalAmount, paymentMethod: input.paymentMethod,
          paymentStatus: input.paymentStatus, paymentReference: input.paymentReference,
          itemTitlesSummary: input.itemTitlesSummary, itemCount: input.itemCount, downloadCount: 0,
          maxDownloads: input.maxDownloads, expiresAtMs: input.expiresAtMs, createdAt: new Date(), updatedAt: new Date() });
        tx.create(idemRef, { buyerId: input.buyerId, orderNumber: input.orderNumber, orderId: input.orderId,
          requestHash, createdAtIso: new Date().toISOString() });
        if (paymentRef) tx.create(paymentRef, { sellerId: input.sellerId, paymentMethod: input.paymentMethod,
          orderNumber: input.orderNumber, referenceHash: referenceKey, createdAtIso: new Date().toISOString() });
        return { duplicate: false, order: input };
      });
    },
    async order(orderNumber) {
      const snap = await ledger.doc(orderNumber).get();
      return snap.exists ? snap.data() || null : null;
    },
    async emailNotification(orderNumber) {
      const snap = await ledger.doc(orderNumber).get();
      if (!snap.exists) return null;
      const row = snap.data() || {};
      return { orderNumber, buyerId: row.buyerId, sellerId: row.sellerId,
        paymentStatus: row.paymentStatus,
        notification: row.buyerEmailNotification && typeof row.buyerEmailNotification === 'object'
          ? row.buyerEmailNotification : null };
    },
    async ledgerEntries(sellerId, admin, storeId, cursor, limit) {
      let query: any = ledger.limit(1000);
      if (!admin) query = ledger.where('sellerId', '==', sellerId).limit(1000);
      else if (sellerId) query = ledger.where('sellerId', '==', sellerId).limit(1000);
      const snap = await query.get();
      const all: Array<Record<string, any>> = snap.docs.map((doc: any) => ({ ...(doc.data() || {}), orderNumber: doc.id }))
        .filter((row: Record<string, any>) => !storeId || row.storeId === storeId)
        .filter((row: Record<string, any>) => !cursor || String(row.orderNumber) > cursor)
        .sort((a: Record<string, any>, b: Record<string, any>) => String(a.orderNumber).localeCompare(String(b.orderNumber)));
      const page = all.slice(0, limit + 1);
      const hasMore = page.length > limit;
      const entries = hasMore ? page.slice(0, limit) : page;
      let auditTrail: Array<Record<string, any>> = [];
      if (admin) {
        let auditQuery: any = db.collection('ledger_audit').limit(500);
        if (sellerId) auditQuery = db.collection('ledger_audit').where('sellerId', '==', sellerId).limit(200);
        const audits = await auditQuery.get();
        auditTrail = audits.docs.map((doc: any) => ({ ...(doc.data() || {}), auditId: doc.id }))
          .filter((row: Record<string, any>) => !storeId || row.storeId === storeId)
          .sort((a: Record<string, any>, b: Record<string, any>) => String(b.createdAtIso || b.atIso || '').localeCompare(String(a.createdAtIso || a.atIso || '')));
      }
      return { entries, auditTrail, hasMore, nextCursor: hasMore && entries.length ? String(entries[entries.length - 1].orderNumber) : null };
    },
    async issueCommissionInvoices(sellerId) {
      if (invoiceSigningSecret.length < 32) throw new ApiError(503, 'commission/signing-unavailable', 'Commission invoice signing is unavailable.');
      const rows = await ledger.where('sellerId', '==', sellerId).get();
      const eligible = rows.docs.map(doc => ({ id: doc.id, data: doc.data() || {} }))
        .filter(row => row.data.paymentStatus === 'Paid' && Number(row.data.grossAmountMinor) > 0 &&
          Number.isSafeInteger(row.data.platformCommissionMinor) && row.data.platformCommissionMinor >= 0 &&
          !row.data.invoiceId && row.data.commissionStatus !== 'reversed' && row.data.commissionStatus !== 'disputed' &&
          ['Manually Verified by Seller', 'Gateway Verified'].includes(String(row.data.verificationMode)))
        .sort((a, b) => String(a.data.createdAtIso || '').localeCompare(String(b.data.createdAtIso || '')) || a.id.localeCompare(b.id));
      const groups = new Map<string, typeof eligible>();
      for (const row of eligible) groups.set(String(row.data.currency), [...(groups.get(String(row.data.currency)) || []), row]);
      const issued: Array<Record<string, any>> = [];
      for (const [currency, group] of groups) {
        for (let offset = 0; offset + COMMISSION_INVOICE_THRESHOLD <= group.length; offset += COMMISSION_INVOICE_THRESHOLD) {
          const batch = group.slice(offset, offset + COMMISSION_INVOICE_THRESHOLD);
          const numbers = batch.map(row => row.id);
          const digest = createHash('sha256').update([sellerId, currency, ...numbers].join(':')).digest('hex');
          const invoiceId = `inv-${digest.slice(0, 28)}`;
          const invoiceRef = db.collection('commission_invoices').doc(invoiceId);
          const created = await db.runTransaction(async tx => {
            const [existing, ...latest] = await Promise.all([tx.get(invoiceRef), ...numbers.map(number => tx.get(ledger.doc(number)))]);
            if (existing.exists) return existing.data() || null;
            const fresh = latest.map(snap => snap.exists ? snap.data() || {} : null);
            if (fresh.some(row => !row || row.sellerId !== sellerId || row.currency !== currency || row.paymentStatus !== 'Paid' ||
              row.invoiceId || row.commissionStatus === 'reversed' || row.commissionStatus === 'disputed' ||
              !['Manually Verified by Seller', 'Gateway Verified'].includes(String(row.verificationMode)))) return null;
            if (fresh.some(row => {
              try {
                const expected = commissionBreakdown(Number(row!.grossAmountMinor), String(row!.currency), String(row!.paymentMethod));
                return row!.commissionRateBps !== 500 || expected.platformCommissionMinor !== row!.platformCommissionMinor ||
                  !Number.isSafeInteger(row!.grossAmountMinor);
              } catch { return true; }
            })) throw new ApiError(409, 'commission/invalid-snapshot', 'Commission source entries do not match the fixed 5% ledger policy.');
            const grossSalesMinor = fresh.reduce((sum, row) => sum + Number(row!.grossAmountMinor), 0);
            const commissionAmountMinor = fresh.reduce((sum, row) => sum + Number(row!.platformCommissionMinor), 0);
            if (!Number.isSafeInteger(grossSalesMinor) || !Number.isSafeInteger(commissionAmountMinor) || commissionAmountMinor < 0) {
              throw new ApiError(409, 'commission/invalid-snapshot', 'Commission invoice source records need review.');
            }
            const issuedAtMs = Date.now(); const dueAtMs = issuedAtMs + COMMISSION_INVOICE_WINDOW_MS;
            const storeId = String(fresh[0]!.storeId || '');
            if (!storeId || fresh.some(row => row!.storeId !== storeId)) throw new ApiError(409, 'commission/store-mismatch', 'Invoice orders must belong to one Seller store.');
            const payload = { invoiceId, sellerId, orderNumbers: numbers, commissionAmountMinor, dueAtMs };
            const invoice = { ...payload, invoiceNumber: `INV-${new Date(issuedAtMs).getFullYear()}-${digest.slice(0, 8).toUpperCase()}`,
              storeId, currency, verifiedSalesCount: numbers.length, grossSalesMinor, paidAmountMinor: 0,
              adjustedAmountMinor: 0, remainingBalanceMinor: commissionAmountMinor, status: 'open', issuedAtMs, dueAtMs,
              issuedAtIso: new Date(issuedAtMs).toISOString(), dueAtIso: new Date(dueAtMs).toISOString(),
              serverSignature: createHmac('sha256', invoiceSigningSecret).update(
                `inv:${invoiceId}:${sellerId}:${numbers.join(',')}:${commissionAmountMinor}:${dueAtMs}`,
              ).digest('hex') };
            const auditId = randomUUID();
            tx.create(invoiceRef, invoice);
            for (const number of numbers) tx.update(ledger.doc(number), { invoiceId, updatedAtIso: new Date().toISOString() });
            tx.create(db.collection('ledger_audit').doc(auditId), { auditId, invoiceId, sellerId,
              actorUid: 'system', action: 'INVOICE_GENERATED', previousStatus: 'unbilled', newStatus: 'open',
              atIso: new Date(issuedAtMs).toISOString(), createdAtIso: new Date(issuedAtMs).toISOString() });
            return invoice;
          });
          if (created) issued.push(created);
        }
      }
      return issued;
    },
    async commissionRecords(sellerId) {
      const read = async (name: string) => {
        const query = sellerId ? db.collection(name).where('sellerId', '==', sellerId).limit(1000) : db.collection(name).limit(1000);
        const snap = await query.get();
        return snap.docs.map(doc => ({ ...doc.data(), [name === 'commission_invoices' ? 'invoiceId' : name === 'commission_payments' ? 'paymentId' : 'adjustmentId']: doc.id }));
      };
      const [invoices, payments, adjustments] = await Promise.all([
        read('commission_invoices'), read('commission_payments'), read('commission_adjustments'),
      ]);
      return { invoices, payments, adjustments };
    },
    async submitCommissionPayment(input) {
      const invoiceId = String(input.invoiceId || '');
      const invoiceRef = db.collection('commission_invoices').doc(invoiceId);
      const paymentId = `cpay-${randomUUID()}`;
      const paymentRef = db.collection('commission_payments').doc(paymentId);
      const reference = String(input.paymentReference || '').trim().toUpperCase();
      const referenceHash = createHash('sha256').update(reference).digest('hex');
      const refRef = db.collection('commission_payment_refs').doc(referenceHash);
      const now = new Date().toISOString();
      return db.runTransaction(async tx => {
        const [invoiceSnap, referenceSnap, disputesSnap] = await Promise.all([
          tx.get(invoiceRef), tx.get(refRef),
          tx.get(db.collection('commission_disputes').where('invoiceId', '==', invoiceId).where('status', '==', 'pending')),
        ]);
        if (!invoiceSnap.exists) throw new ApiError(404, 'commission/invoice-not-found', 'Commission invoice not found.');
        if (referenceSnap.exists) throw new ApiError(409, 'commission/duplicate-reference', 'This transfer reference has already been submitted.');
        const invoice = invoiceSnap.data() || {};
        if (invoice.sellerId !== input.sellerId) throw new ApiError(403, 'commission/invoice-forbidden', 'Invoice belongs to another Seller.');
        if (disputesSnap.docs.length > 0 || (Array.isArray(invoice.pendingDisputeIds) && invoice.pendingDisputeIds.length > 0)) throw new ApiError(409, 'commission/dispute-pending', 'Invoice settlement is paused while an Admin reviews an open commission dispute.');
        const balance = Number(invoice.remainingBalanceMinor); const amount = input.amountMinor === undefined ? balance : Number(input.amountMinor);
        if (invoice.status === 'payment_submitted') throw new ApiError(409, 'commission/proof-pending', 'This invoice already has payment evidence awaiting review.');
        if (!Number.isSafeInteger(balance) || balance <= 0 || !Number.isSafeInteger(amount) || amount <= 0 || amount > balance || invoice.status === 'paid') {
          throw new ApiError(409, 'commission/invalid-amount', 'Payment must be a positive integer amount up to the outstanding invoice balance.');
        }
        if (!reference || reference.length > 160) throw new ApiError(422, 'commission/invalid-reference', 'A valid transfer reference is required.');
        const payment = { paymentId, invoiceId, invoiceNumber: invoice.invoiceNumber, sellerId: invoice.sellerId,
          storeId: invoice.storeId, currency: invoice.currency, amountMinor: amount,
          paymentMethod: String(input.paymentMethod), paymentReference: reference,
          proofNote: String(input.proofNote || '').slice(0, 500), status: 'submitted', submittedByUid: input.sellerId,
          evidenceSubmittedAtIso: now, createdAtIso: now, updatedAtIso: now };
        const updatedInvoice = { ...invoice, status: 'payment_submitted', lastPaymentMethod: payment.paymentMethod,
          lastPaymentReference: reference, lastPaymentProofNote: payment.proofNote, submittedAtIso: now };
        tx.create(paymentRef, payment); tx.create(refRef, { paymentId, invoiceId, sellerId: input.sellerId, createdAtIso: now });
        tx.update(invoiceRef, { status: updatedInvoice.status, lastPaymentMethod: payment.paymentMethod,
          lastPaymentReference: reference, lastPaymentProofNote: payment.proofNote, submittedAtIso: now });
        const auditId = randomUUID();
        tx.create(db.collection('ledger_audit').doc(auditId), { auditId, invoiceId, paymentId,
          sellerId: input.sellerId, actorUid: input.sellerId, action: 'COMMISSION_PAYMENT_SUBMITTED',
          previousStatus: invoice.status, newStatus: 'payment_submitted', verificationMode: 'Seller Attestation', atIso: now, createdAtIso: now });
        return { payment, invoice: updatedInvoice };
      });
    },
    async reviewCommissionPayment(input) {
      const paymentRef = db.collection('commission_payments').doc(String(input.paymentId));
      const now = new Date().toISOString();
      return db.runTransaction(async tx => {
        const paymentSnap = await tx.get(paymentRef);
        if (!paymentSnap.exists) throw new ApiError(404, 'commission/payment-not-found', 'Submitted commission payment was not found.');
        const payment = paymentSnap.data() || {};
        if (payment.invoiceId !== input.invoiceId || payment.status !== 'submitted') throw new ApiError(409, 'commission/payment-reviewed', 'Payment was already reviewed or does not match the invoice.');
        if (payment.sellerId === input.actorUid) throw new ApiError(403, 'commission/self-approval', 'A Seller cannot approve their own commission settlement.');
        const invoiceRef = db.collection('commission_invoices').doc(String(payment.invoiceId));
        const [invoiceSnap, disputesSnap] = await Promise.all([
          tx.get(invoiceRef),
          tx.get(db.collection('commission_disputes').where('invoiceId', '==', payment.invoiceId).where('status', '==', 'pending')),
        ]);
        if (!invoiceSnap.exists) throw new ApiError(409, 'commission/invoice-missing', 'Payment invoice is unavailable.');
        if (disputesSnap.docs.length > 0 || (Array.isArray(invoiceSnap.get('pendingDisputeIds')) && invoiceSnap.get('pendingDisputeIds').length > 0)) throw new ApiError(409, 'commission/dispute-pending', 'Settlement review is paused while an Admin reviews an open commission dispute.');
        const invoice = invoiceSnap.data() || {};
        const amount = Number(payment.amountMinor); const remaining = Number(invoice.remainingBalanceMinor);
        if (invoice.sellerId !== payment.sellerId || invoice.storeId !== payment.storeId || invoice.currency !== payment.currency ||
            !Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(remaining) || amount > remaining) {
          throw new ApiError(409, 'commission/record-mismatch', 'Saved payment and invoice totals require administrative review.');
        }
        if (input.decision === 'approve' && input.fundsConfirmed !== true) throw new ApiError(422, 'commission/evidence-required', 'Confirm cleared funds were independently checked against external account evidence.');
        const previousPaidAmountMinor = Number(invoice.paidAmountMinor || 0);
        if (!Number.isSafeInteger(previousPaidAmountMinor) || previousPaidAmountMinor < 0 || !Number.isSafeInteger(Number(invoice.dueAtMs))) {
          throw new ApiError(409, 'commission/invoice-invalid', 'Commission invoice totals or due date require review.');
        }
        const paidAmountMinor = previousPaidAmountMinor + (input.decision === 'approve' ? amount : 0);
        if (!Number.isSafeInteger(paidAmountMinor)) throw new ApiError(409, 'commission/amount-overflow', 'Commission settlement amount exceeds safe accounting limits.');
        const remainingBalanceMinor = remaining - (input.decision === 'approve' ? amount : 0);
        const invoiceStatus = input.decision === 'approve' ? (remainingBalanceMinor === 0 ? 'paid' : 'open') :
          (Date.now() > Number(invoice.dueAtMs) ? 'overdue' : 'open');
        const newPayment = { ...payment, status: input.decision === 'approve' ? 'verified' : 'rejected',
          reviewMode: input.decision === 'approve' ? 'Super Admin Attested Cleared Funds' : 'Super Admin Rejected',
          reviewedByUid: input.actorUid, reviewedAtIso: now, reviewNote: String(input.note || '').slice(0, 300), updatedAtIso: now };
        const newInvoice = { ...invoice, status: invoiceStatus, paidAmountMinor, remainingBalanceMinor,
          ...(input.decision === 'approve' ? { verifiedByAdminUid: input.actorUid, verifiedAtIso: now } : {}) };
        const orderNumbers = Array.isArray(invoice.orderNumbers) ? invoice.orderNumbers as string[] : [];
        const ledgerRefs: DocumentReference[] = input.decision === 'approve' && remainingBalanceMinor === 0
          ? orderNumbers.map(n => ledger.doc(n)) : [];
        const entryRefs: DocumentReference[] = ledgerRefs.map(ref => db.collection('commission_entries').doc(ref.id));
        const [ledgerSnaps, entrySnaps] = await Promise.all([
          Promise.all(ledgerRefs.map(ref => tx.get(ref))), Promise.all(entryRefs.map(ref => tx.get(ref))),
        ]);
        for (let i = 0; i < ledgerSnaps.length; i++) {
          const source = ledgerSnaps[i].data() || {};
          if (!ledgerSnaps[i].exists || source.invoiceId !== invoice.invoiceId || source.sellerId !== invoice.sellerId || source.currency !== invoice.currency) {
            throw new ApiError(409, 'commission/invoice-source-mismatch', 'Invoice source orders require administrative review.');
          }
          if (entrySnaps[i].exists && (entrySnaps[i].get('sellerId') !== source.sellerId ||
              entrySnaps[i].get('platformCommissionMinor') !== source.platformCommissionMinor ||
              entrySnaps[i].get('currency') !== source.currency)) {
            throw new ApiError(409, 'commission/entry-mismatch', 'Commission entry and invoice source do not match.');
          }
        }
        tx.update(paymentRef, { status: newPayment.status, reviewMode: newPayment.reviewMode, reviewedByUid: input.actorUid,
          reviewedAtIso: now, reviewNote: newPayment.reviewNote, updatedAtIso: now });
        tx.update(invoiceRef, { status: invoiceStatus, paidAmountMinor, remainingBalanceMinor,
          ...(input.decision === 'approve' ? { verifiedByAdminUid: input.actorUid, verifiedAtIso: now } : {}) });
        for (let i = 0; i < ledgerSnaps.length; i++) {
          tx.update(ledgerRefs[i], { commissionStatus: 'paid', updatedAtIso: now });
          if (entrySnaps[i].exists) tx.update(entryRefs[i], { status: 'paid', updatedAtIso: now });
          else tx.create(entryRefs[i], { ...commissionEntry(ledgerSnaps[i].data() || {}), status: 'paid', updatedAtIso: now });
        }
        const auditId = randomUUID();
        tx.create(db.collection('ledger_audit').doc(auditId), { auditId, invoiceId: invoice.invoiceId,
          paymentId: payment.paymentId, sellerId: payment.sellerId, actorUid: input.actorUid,
          action: input.decision === 'approve' ? 'COMMISSION_PAYMENT_VERIFIED' : 'COMMISSION_PAYMENT_REJECTED',
          previousStatus: 'payment_submitted', newStatus: newPayment.status, verificationMode: newPayment.reviewMode, atIso: now, createdAtIso: now });
        return { payment: newPayment, invoice: newInvoice };
      });
    },
    async disputeCommission(orderNumber, sellerId, note) {
      const ref = ledger.doc(orderNumber); const now = new Date().toISOString();
      const disputeId = 'cd-' + createHash('sha256').update(orderNumber).digest('hex').slice(0, 32);
      const disputeRef = db.collection('commission_disputes').doc(disputeId);
      const commissionRef = db.collection('commission_entries').doc(orderNumber);
      return db.runTransaction(async tx => {
        const [snap, commissionSnap, existing] = await Promise.all([tx.get(ref), tx.get(commissionRef), tx.get(disputeRef)]);
        if (!snap.exists) throw new ApiError(404, 'commission/order-not-found', 'Order not found.');
        const old = snap.data() || {};
        if (old.sellerId !== sellerId) throw new ApiError(403, 'commission/order-forbidden', 'Order belongs to another Seller.');
        if (existing.exists) throw new ApiError(409, 'commission/dispute-duplicate', 'A dispute already exists for this order.');
        if (old.paymentStatus !== 'Paid' || !['outstanding', 'disputed', 'paid'].includes(String(old.commissionStatus)) ||
            !Number.isSafeInteger(old.grossAmountMinor) || old.grossAmountMinor <= 0 ||
            !Number.isSafeInteger(old.platformCommissionMinor) || old.platformCommissionMinor < 0 || old.commissionRateBps !== 500) {
          throw new ApiError(409, 'commission/dispute-conflict', 'This commission record is not eligible for a dispute.');
        }
        if (!commissionSnap.exists || commissionSnap.get('sellerId') !== sellerId || commissionSnap.get('currency') !== old.currency ||
            commissionSnap.get('grossAmountMinor') !== old.grossAmountMinor ||
            commissionSnap.get('platformCommissionMinor') !== old.platformCommissionMinor || commissionSnap.get('commissionRateBps') !== 500) {
          throw new ApiError(409, 'commission/entry-mismatch', 'The commission entry and source order require administrative review.');
        }
        let invoice: Record<string, any> | null = null;
        if (old.invoiceId) {
          const invoiceSnap = await tx.get(db.collection('commission_invoices').doc(String(old.invoiceId)));
          if (!invoiceSnap.exists) throw new ApiError(409, 'commission/invoice-missing', 'The linked invoice requires administrative review.');
          invoice = invoiceSnap.data() || {};
          if (invoice.sellerId !== sellerId || invoice.currency !== old.currency ||
              !Array.isArray(invoice.orderNumbers) || !invoice.orderNumbers.includes(orderNumber) ||
              !Number.isSafeInteger(invoice.remainingBalanceMinor) || !Number.isSafeInteger(invoice.paidAmountMinor)) {
            throw new ApiError(409, 'commission/invoice-mismatch', 'The linked invoice totals require administrative review.');
          }
          const pendingPayments = await tx.get(db.collection('commission_payments')
            .where('invoiceId', '==', old.invoiceId).where('status', '==', 'submitted'));
          if (pendingPayments.docs.length || invoice.status === 'payment_submitted') throw new ApiError(409, 'commission/payment-pending', 'Review submitted invoice payment evidence before disputing this commission.');
          tx.update(db.collection('commission_invoices').doc(String(old.invoiceId)), {
            pendingDisputeIds: [...new Set([...(Array.isArray(invoice.pendingDisputeIds) ? invoice.pendingDisputeIds : []), disputeId])],
          });
        }
        const auditId = randomUUID();
        const dispute = { disputeId, orderNumber, orderId: old.orderId || '', sellerId, storeId: old.storeId || '',
          invoiceId: String(old.invoiceId || ''), currency: String(old.currency || ''),
          disputedCommissionMinor: Number(old.platformCommissionMinor), previousCommissionStatus: String(old.commissionStatus),
          reason: note.slice(0, 500), status: 'pending',
          submittedByUid: sellerId, submittedAtIso: now, createdAtIso: now, updatedAtIso: now };
        tx.create(disputeRef, dispute);
        tx.update(ref, { commissionStatus: 'disputed', commissionDisputeNote: dispute.reason,
          commissionDisputeId: disputeId, updatedAtIso: now });
        tx.update(commissionRef, { status: 'disputed', disputeId, updatedAtIso: now });
        tx.create(db.collection('ledger_audit').doc(auditId), { auditId, disputeId, invoiceId: dispute.invoiceId || null,
          orderNumber, orderId: old.orderId, sellerId, actorUid: sellerId, action: 'COMMISSION_DISPUTE_SUBMITTED',
          previousStatus: old.commissionStatus, newStatus: 'disputed', amountMinor: dispute.disputedCommissionMinor,
          explanation: dispute.reason, atIso: now, createdAtIso: now });
        return { ...dispute, commissionStatus: 'disputed' };
      });
    },
    async listCommissionDisputes(limit) {
      const bounded = Math.max(1, Math.min(200, Math.floor(limit || 100)));
      const snap = await db.collection('commission_disputes').limit(bounded).get();
      return snap.docs.map(doc => ({ ...doc.data(), disputeId: doc.id }));
    },
    async resolveCommissionDispute(input) {
      const disputeRef = db.collection('commission_disputes').doc(input.disputeId);
      const now = new Date().toISOString();
      return db.runTransaction(async tx => {
        const disputeSnap = await tx.get(disputeRef);
        if (!disputeSnap.exists) throw new ApiError(404, 'commission/dispute-not-found', 'Commission dispute not found.');
        const dispute = disputeSnap.data() || {};
        if (dispute.status !== 'pending') throw new ApiError(409, 'commission/dispute-resolved', 'This dispute has already been resolved.');
        const orderRef = ledger.doc(String(dispute.orderNumber));
        const commissionRef = db.collection('commission_entries').doc(String(dispute.orderNumber));
        const [orderSnap, commissionSnap] = await Promise.all([tx.get(orderRef), tx.get(commissionRef)]);
        if (!orderSnap.exists) throw new ApiError(409, 'commission/dispute-order-missing', 'The source order requires administrative review.');
        if (!commissionSnap.exists) throw new ApiError(409, 'commission/entry-missing', 'The commission entry requires administrative review.');
        const order = orderSnap.data() || {};
        if (order.sellerId !== dispute.sellerId || order.commissionDisputeId !== dispute.disputeId ||
            order.commissionStatus !== 'disputed' || order.paymentStatus !== 'Paid' ||
            order.platformCommissionMinor !== dispute.disputedCommissionMinor || order.currency !== dispute.currency) {
          throw new ApiError(409, 'commission/dispute-record-mismatch', 'Dispute and commission source records do not match.');
        }
        if (commissionSnap.get('sellerId') !== dispute.sellerId || commissionSnap.get('currency') !== dispute.currency ||
            commissionSnap.get('platformCommissionMinor') !== dispute.disputedCommissionMinor || commissionSnap.get('status') !== 'disputed') {
          throw new ApiError(409, 'commission/entry-mismatch', 'The commission entry and dispute record require administrative review.');
        }
        let invoice: Record<string, any> | null = null;
        let invoiceRef: DocumentReference | null = null;
        if (dispute.invoiceId) {
          invoiceRef = db.collection('commission_invoices').doc(String(dispute.invoiceId));
          const invoiceSnap = await tx.get(invoiceRef);
          if (!invoiceSnap.exists) throw new ApiError(409, 'commission/invoice-missing', 'The linked invoice requires administrative review.');
          invoice = invoiceSnap.data() || {};
          if (invoice.sellerId !== dispute.sellerId || invoice.currency !== dispute.currency ||
              !Array.isArray(invoice.orderNumbers) || !invoice.orderNumbers.includes(dispute.orderNumber) ||
              !Number.isSafeInteger(invoice.commissionAmountMinor) || !Number.isSafeInteger(invoice.remainingBalanceMinor) ||
              !Number.isSafeInteger(invoice.paidAmountMinor) || !Number.isSafeInteger(invoice.adjustedAmountMinor)) {
            throw new ApiError(409, 'commission/invoice-mismatch', 'Invoice totals or ownership require administrative review.');
          }
          const pendingPayments = await tx.get(db.collection('commission_payments')
            .where('invoiceId', '==', dispute.invoiceId).where('status', '==', 'submitted'));
          if (pendingPayments.docs.length) throw new ApiError(409, 'commission/payment-pending', 'Review the submitted invoice payment before resolving this dispute.');
          if (invoice.status === 'payment_submitted') throw new ApiError(409, 'commission/invoice-payment-mismatch', 'Invoice indicates a submitted payment that has no pending payment record.');
        }
        const commissionMinor = Number(dispute.disputedCommissionMinor);
        if (!Number.isSafeInteger(commissionMinor) || commissionMinor < 0) throw new ApiError(409, 'commission/dispute-amount-invalid', 'Dispute amount requires administrative review.');
        let reconciliationRequiredMinor = 0;
        let invoiceAdjustment: Record<string, any> | null = null;
        if (input.decision === 'approve' && invoice) {
          const unpaid = Number(invoice.remainingBalanceMinor);
          const paid = Number(invoice.paidAmountMinor);
          if (unpaid < 0 || paid < 0 || paid + unpaid > Number(invoice.commissionAmountMinor) + Number(invoice.adjustedAmountMinor)) {
            throw new ApiError(409, 'commission/invoice-balance-invalid', 'Invoice balance requires administrative review.');
          }
          const adjustmentId = 'adj-' + createHash('sha256').update(`${dispute.invoiceId}:${dispute.orderNumber}:dispute`).digest('hex').slice(0, 32);
          const adjustmentRef = db.collection('commission_adjustments').doc(adjustmentId);
          const adjustmentSnap = await tx.get(adjustmentRef);
          if (adjustmentSnap.exists) throw new ApiError(409, 'commission/dispute-adjustment-exists', 'A dispute adjustment already exists; financial records require review.');
          // Only the amount still represented in an unpaid invoice balance can
          // be reduced automatically. Already settled or previously adjusted
          // portions require a human reconciliation; never create a credit.
          if (paid === 0 && invoice.status !== 'payment_submitted') {
            const reduction = Math.min(unpaid, commissionMinor);
            reconciliationRequiredMinor = commissionMinor - reduction;
            const nextRemaining = unpaid - reduction;
            const nextAdjusted = Number(invoice.adjustedAmountMinor) + reduction;
            if (!Number.isSafeInteger(nextAdjusted)) throw new ApiError(409, 'commission/adjustment-overflow', 'Adjustment exceeds safe accounting limits.');
            tx.update(invoiceRef!, { remainingBalanceMinor: nextRemaining, adjustedAmountMinor: nextAdjusted,
              status: nextRemaining === 0 ? 'voided' : invoice.status,
              pendingDisputeIds: (Array.isArray(invoice.pendingDisputeIds) ? invoice.pendingDisputeIds : []).filter((id: string) => id !== dispute.disputeId) });
            invoiceAdjustment = { adjustmentId, amountMinor: -reduction, adjustmentAmountMinor: reduction };
          } else {
            reconciliationRequiredMinor = commissionMinor;
            tx.update(invoiceRef!, { pendingDisputeIds: (Array.isArray(invoice.pendingDisputeIds) ? invoice.pendingDisputeIds : []).filter((id: string) => id !== dispute.disputeId) });
            invoiceAdjustment = { adjustmentId, amountMinor: -commissionMinor, adjustmentAmountMinor: commissionMinor };
          }
          tx.create(adjustmentRef, { adjustmentId, invoiceId: dispute.invoiceId,
            invoiceNumber: String(invoice.invoiceNumber || ''), orderNumber: dispute.orderNumber,
            sellerId: dispute.sellerId, currency: dispute.currency,
            adjustmentAmountMinor: invoiceAdjustment.adjustmentAmountMinor, amountMinor: invoiceAdjustment.amountMinor,
            reason: 'commission_dispute_approved', detail: reconciliationRequiredMinor
              ? 'Approved commission dispute; the unpaid invoice does not contain the full disputed amount, so human reconciliation is required.'
              : 'Approved commission dispute; unpaid invoice balance reduced.',
            disputeId: dispute.disputeId, reconciliationRequiredMinor,
            reconciliationStatus: reconciliationRequiredMinor ? 'human_review_required' : 'applied_to_unpaid_balance',
            actorUid: input.actorUid, createdAtIso: now });
        } else if (input.decision === 'approve' && !invoice) {
          const adjustmentId = `${dispute.orderNumber}:dispute`;
          const adjustmentRef = db.collection('commission_adjustments').doc(adjustmentId);
          const adjustmentSnap = await tx.get(adjustmentRef);
          if (adjustmentSnap.exists) throw new ApiError(409, 'commission/dispute-adjustment-exists', 'A dispute adjustment already exists; financial records require review.');
          tx.create(adjustmentRef, { adjustmentId, invoiceId: '', invoiceNumber: '', orderNumber: dispute.orderNumber,
            sellerId: dispute.sellerId, currency: dispute.currency, adjustmentAmountMinor: commissionMinor,
            amountMinor: -commissionMinor, reason: 'commission_dispute_approved',
            detail: 'Approved uninvoiced commission dispute; commission waived.', disputeId: dispute.disputeId,
            reconciliationRequiredMinor: 0, reconciliationStatus: 'waived_before_invoice', actorUid: input.actorUid, createdAtIso: now });
        }
        if (input.decision === 'reject' && invoice && invoiceRef) {
          tx.update(invoiceRef, { pendingDisputeIds: (Array.isArray(invoice.pendingDisputeIds) ? invoice.pendingDisputeIds : []).filter((id: string) => id !== dispute.disputeId) });
        }
        const priorStatus = String(order.commissionStatus);
        const nextStatus = input.decision === 'approve' ? 'reversed' : String(dispute.previousCommissionStatus || 'outstanding');
        const nextDispute = { ...dispute, status: input.decision === 'approve' ? 'approved' : 'rejected',
          decision: input.decision, resolutionExplanation: input.explanation.slice(0, 1000), resolvedByUid: input.actorUid,
          resolvedAtIso: now, updatedAtIso: now, reconciliationRequiredMinor };
        tx.update(disputeRef, { status: nextDispute.status, decision: nextDispute.decision,
          resolutionExplanation: nextDispute.resolutionExplanation, resolvedByUid: input.actorUid,
          resolvedAtIso: now, updatedAtIso: now, reconciliationRequiredMinor });
        tx.update(orderRef, { commissionStatus: nextStatus, commissionDisputeResolvedAtIso: now,
          commissionDisputeDecision: input.decision, commissionDisputeResolvedByUid: input.actorUid, updatedAtIso: now });
        tx.update(commissionRef, { status: nextStatus, disputeResolvedAtIso: now,
          disputeDecision: input.decision, updatedAtIso: now });
        const auditId = randomUUID();
        tx.create(db.collection('ledger_audit').doc(auditId), { auditId, disputeId: dispute.disputeId,
          invoiceId: dispute.invoiceId || null, orderNumber: dispute.orderNumber, sellerId: dispute.sellerId,
          actorUid: input.actorUid, action: input.decision === 'approve' ? 'COMMISSION_DISPUTE_APPROVED' : 'COMMISSION_DISPUTE_REJECTED',
          previousStatus: priorStatus, newStatus: nextStatus, amountMinor: commissionMinor,
          reconciliationRequiredMinor, explanation: nextDispute.resolutionExplanation, atIso: now, createdAtIso: now });
        return nextDispute;
      });
    },
    async listOrders(uid, admin) {
      let snapshots;
      if (admin) snapshots = [await ledger.limit(500).get()];
      else snapshots = await Promise.all([ledger.where('buyerId', '==', uid).limit(200).get(), ledger.where('sellerId', '==', uid).limit(200).get()]);
      const unique = new Map<string, Record<string, any>>();
      for (const group of snapshots) for (const doc of group.docs) unique.set(doc.id, doc.data());
      return [...unique.values()].sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')));
    },
    async transitionOrder(orderNumber, expectedStatus, patch, actorUid) {
      const ledgerRef = ledger.doc(orderNumber);
      return db.runTransaction(async tx => {
        const snap = await tx.get(ledgerRef);
        if (!snap.exists) throw new ApiError(404, 'orders/not-found', 'Order not found.');
        const old = snap.data() || {};
        if (old.sellerId !== actorUid) throw new ApiError(403, 'orders/seller-forbidden', 'Order belongs to another Seller.');
        if (old.paymentStatus !== expectedStatus) throw new ApiError(409, 'orders/transition-conflict', 'Order was already reviewed or is no longer pending.');
        const disputeRef = db.collection('commission_disputes').doc('cd-' + createHash('sha256').update(orderNumber).digest('hex').slice(0, 32));
        const disputeSnap = patch.paymentStatus === 'Refunded' ? await tx.get(disputeRef) : null;
        if (disputeSnap?.exists && disputeSnap.get('status') === 'pending') {
          throw new ApiError(409, 'orders/dispute-pending', 'Resolve the commission dispute before processing a refund.');
        }
        const next = { ...old, ...patch };
        const orderRef = orders.doc(String(old.orderId));
        const commissionRef = db.collection('commission_entries').doc(orderNumber);
        const commissionSnap = (patch.paymentStatus === 'Paid' || patch.paymentStatus === 'Refunded') && Number(old.grossAmountMinor) > 0 ? await tx.get(commissionRef) : null;
        const hasRefundAdjustment = patch.paymentStatus === 'Refunded' && Number(old.grossAmountMinor) > 0;
        const adjustmentId = hasRefundAdjustment ? (old.invoiceId
          ? 'adj-' + createHash('sha256').update(`${old.invoiceId}:${orderNumber}:refund`).digest('hex').slice(0, 32)
          : `${orderNumber}:refund`) : '';
        const adjustmentRef = hasRefundAdjustment ? db.collection('commission_adjustments').doc(adjustmentId) : null;
        const [adjustmentSnap, invoiceSnap] = hasRefundAdjustment
          ? await Promise.all([tx.get(adjustmentRef!), old.invoiceId
            ? tx.get(db.collection('commission_invoices').doc(String(old.invoiceId))) : Promise.resolve(null)])
          : [null, null];
        if (adjustmentSnap?.exists) throw new ApiError(409, 'orders/refund-already-adjusted', 'Refund adjustment already exists; financial records require review.');
        const now = new Date().toISOString();
        const audit = { auditId: randomUUID(), orderNumber, orderId: old.orderId, sellerId: old.sellerId,
          actorUid, action: patch.paymentStatus === 'Paid' ? 'MANUAL_PAYMENT_VERIFIED' : 'PAYMENT_REJECTED',
          previousStatus: old.paymentStatus, newStatus: patch.paymentStatus, atIso: now, createdAtIso: now,
          ...(next.paymentEvidence ? { paymentEvidence: next.paymentEvidence } : {}) };
        next.paymentAudit = [...(Array.isArray(old.paymentAudit) ? old.paymentAudit : []), audit];
        next.updatedAtIso = now;
        tx.set(ledgerRef, next);
        tx.set(orderRef, { paymentStatus: next.paymentStatus, verificationMode: next.verificationMode,
          commissionStatus: next.commissionStatus, payoutStatus: next.payoutStatus,
          verifiedByUid: next.verifiedByUid || null, verifiedAtIso: next.verifiedAtIso || null,
          refundedAtIso: next.refundedAtIso || null, refundReference: next.refundReference || null,
          downloadTokenId: next.downloadTokenId, paymentEvidence: next.paymentEvidence || null,
          updatedAt: new Date(), paymentReference: old.paymentReference }, { merge: true });
        tx.create(db.collection('ledger_audit').doc(audit.auditId), audit);
        if (patch.paymentStatus === 'Paid' && commissionSnap && !commissionSnap.exists) tx.create(commissionRef, commissionEntry(next));
        if (patch.paymentStatus === 'Refunded' && commissionSnap?.exists) {
          tx.set(commissionRef, { status: 'reversed', reversedAtIso: now, updatedAtIso: now }, { merge: true });
          if (adjustmentRef) {
            const originalCommission = Number(old.platformCommissionMinor || 0);
            if (!Number.isSafeInteger(originalCommission) || originalCommission < 0 ||
                Number(old.commissionRateBps) !== 500 ||
                commissionBreakdown(Number(old.grossAmountMinor), String(old.currency), String(old.paymentMethod)).platformCommissionMinor !== originalCommission) {
              throw new ApiError(409, 'orders/refund-commission-invalid', 'Refund commission snapshot requires administrative review.');
            }
            const invoice = invoiceSnap?.exists ? invoiceSnap.data() || {} : null;
            let reduction = 0; let invoiceNumber = '';
            if (invoice) {
              if (invoice.sellerId !== old.sellerId || invoice.currency !== old.currency ||
                  !Array.isArray(invoice.orderNumbers) || !invoice.orderNumbers.includes(orderNumber) ||
                  !Number.isSafeInteger(invoice.remainingBalanceMinor) || !Number.isSafeInteger(invoice.adjustedAmountMinor)) {
                throw new ApiError(409, 'orders/refund-invoice-mismatch', 'Refund invoice ownership or balance needs review.');
              }
              reduction = Math.min(Number(invoice.remainingBalanceMinor), originalCommission);
              if (!Number.isSafeInteger(Number(invoice.adjustedAmountMinor) + originalCommission)) throw new ApiError(409, 'orders/refund-adjustment-overflow', 'Refund adjustment exceeds safe accounting limits.');
              const remaining = Number(invoice.remainingBalanceMinor) - reduction;
              const invoiceStatus = remaining === 0 ? Number(invoice.paidAmountMinor || 0) > 0 ? 'paid' : 'voided' : invoice.status;
              invoiceNumber = String(invoice.invoiceNumber || '');
              tx.update(db.collection('commission_invoices').doc(String(old.invoiceId)), {
                adjustedAmountMinor: Number(invoice.adjustedAmountMinor) + originalCommission,
                remainingBalanceMinor: remaining, status: invoiceStatus,
              });
            }
            tx.create(adjustmentRef, {
              adjustmentId, invoiceId: String(old.invoiceId || ''), invoiceNumber,
              orderNumber, sellerId: old.sellerId, currency: old.currency,
              adjustmentAmountMinor: originalCommission, amountMinor: -originalCommission,
              reason: 'order_refunded', detail: 'Reversal of platform commission on refunded order.',
              refundReference: patch.refundReference, actorUid, createdAtIso: now,
            });
          }
        }
        return next;
      });
    },
    async consumeDownload(orderNumber, buyerUid, productId, tokenId) {
      return db.runTransaction(async tx => {
        const orderRef = ledger.doc(orderNumber);
        const snap = await tx.get(orderRef);
        if (!snap.exists) throw new ApiError(404, 'downloads/order-not-found', 'Order not found.');
        const order = snap.data() || {};
        if (order.buyerId !== buyerUid || order.primaryProductId !== productId ||
            !canDownload(order) || order.downloadTokenId !== tokenId) {
          throw new ApiError(403, 'downloads/not-authorized', 'Order is unpaid, revoked, expired, exhausted or does not match this Buyer.');
        }
        const deliverableRef = db.collection('products').doc(productId).collection('deliverables').doc('main');
        const deliverableSnap = await tx.get(deliverableRef);
        if (!deliverableSnap.exists || deliverableSnap.get('ownerId') !== order.sellerId || deliverableSnap.get('productId') !== productId) throw new ApiError(404, 'downloads/file-not-found', 'Original product file is unavailable.');
        const deliverable = deliverableSnap.data() || {};
        assertStorageBinding(deliverable, bucket);
        const fileRef = String(deliverable.fileDataUrl || '');
        const path = fileRef.startsWith('storage://') ? fileRef.slice('storage://'.length) : '';
        const prefix = `deliverables/${order.sellerId}/${productId}/`;
        if (!path.startsWith(prefix) || path.includes('..') || path.slice(prefix.length).includes('/')) throw new ApiError(403, 'downloads/file-invalid', 'Protected product file reference is invalid.');
        const file = bucket.file(path);
        try {
          const [[bytes], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
          const contentType = String(metadata.contentType || deliverable.fileMimeType || 'application/octet-stream');
          if (metadata.metadata?.firebaseStorageDownloadTokens) throw new ApiError(403, 'downloads/public-file-rejected', 'The stored original is not private.');
          validateFileBytes(String(deliverable.fileName || ''), contentType, bytes, 'product');
          if (Number(metadata.size) !== bytes.length || deliverable.storageGeneration &&
              String(deliverable.storageGeneration) !== String(metadata.generation)) {
            throw new ApiError(503, 'storage/file-changed', 'Protected file version could not be verified.');
          }
          const next = { ...order, downloadCount: Number(order.downloadCount || 0) + 1, downloadTokenId: randomUUID(), updatedAtIso: new Date().toISOString() };
          tx.update(orderRef, { downloadCount: next.downloadCount, downloadTokenId: next.downloadTokenId, updatedAtIso: next.updatedAtIso });
          tx.set(orders.doc(String(order.orderId)), { downloadCount: next.downloadCount, downloadTokenId: next.downloadTokenId, updatedAt: new Date() }, { merge: true });
          return { order: next, deliverable, fileDataUrl: `data:${contentType};base64,${bytes.toString('base64')}` };
        } catch (error) {
          if (error instanceof ApiError) throw error;
          throw new ApiError(503, 'storage/download-unavailable', 'The protected original file could not be retrieved.');
        }
      });
    },
  };
}
