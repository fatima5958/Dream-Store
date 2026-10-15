import { createHash, randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { Bucket } from '@google-cloud/storage';
import type { FinancialRepository } from '../contracts.ts';
import { ApiError } from '../errors.ts';
import { commissionEntry } from './commissions.ts';
import { validateFileMetadata } from './uploads.ts';

export function createFirestoreFinancialRepository(db: Firestore, bucket: Bucket): FinancialRepository {
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
      const idemRef = db.collection('checkout_idempotency').doc(idem);
      const ledgerRef = ledger.doc(input.orderNumber); const orderRef = orders.doc(input.orderId);
      const referenceKey = input.grossAmountMinor > 0 ? createHash('sha256').update(`${input.sellerId}:${input.paymentMethod}:${String(input.paymentReference).trim().toUpperCase()}`).digest('hex') : '';
      const paymentRef = referenceKey ? db.collection('payment_reference_claims').doc(referenceKey) : null;
      return db.runTransaction(async tx => {
        const prior = await tx.get(idemRef);
        if (prior.exists) {
          // Same key + different purchase details is a client bug or an attack, never a replay.
          if (String(prior.get('requestFingerprint') ?? '') !== String(input.requestFingerprint ?? '')) {
            throw new ApiError(409, 'checkout/idempotency-conflict', 'This checkout key was already used for a different purchase. Start a new checkout.');
          }
          const savedNumber = String(prior.get('orderNumber') || '');
          const saved = await tx.get(ledger.doc(savedNumber));
          if (!saved.exists) throw new ApiError(503, 'orders/idempotency-corrupt', 'Existing checkout key points to an unavailable order.');
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
        tx.create(idemRef, { buyerId: input.buyerId, orderNumber: input.orderNumber, orderId: input.orderId, requestFingerprint: input.requestFingerprint ?? '', createdAtIso: new Date().toISOString() });
        if (paymentRef) tx.create(paymentRef, { sellerId: input.sellerId, paymentMethod: input.paymentMethod,
          orderNumber: input.orderNumber, referenceHash: referenceKey, createdAtIso: new Date().toISOString() });
        return { duplicate: false, order: input };
      });
    },
    async order(orderNumber) {
      const snap = await ledger.doc(orderNumber).get();
      return snap.exists ? snap.data() || null : null;
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
        const next = { ...old, ...patch };
        const orderRef = orders.doc(String(old.orderId));
        const commissionRef = db.collection('commission_entries').doc(orderNumber);
        const commissionSnap = (patch.paymentStatus === 'Paid' || patch.paymentStatus === 'Refunded') && Number(old.grossAmountMinor) > 0 ? await tx.get(commissionRef) : null;
        const adjustmentRef = db.collection('commission_adjustments').doc(`${orderNumber}:refund`);
        const adjustmentSnap = patch.paymentStatus === 'Refunded' && Number(old.grossAmountMinor) > 0 ? await tx.get(adjustmentRef) : null;
        const invoiceId = patch.paymentStatus === 'Refunded' ? String(old.invoiceId || '') : '';
        const invoiceRef = invoiceId ? db.collection('commission_invoices').doc(invoiceId) : null;
        const invoiceAdjId = invoiceId ? 'adj-' + createHash('sha256').update(invoiceId + ':' + orderNumber + ':refund').digest('hex').slice(0, 32) : '';
        const [invoiceSnap, invoiceAdjSnap] = invoiceRef ? await Promise.all([tx.get(invoiceRef), tx.get(db.collection('commission_adjustments').doc(invoiceAdjId))]) : [null, null];
        const now = new Date().toISOString();
        const audit = { auditId: randomUUID(), orderNumber, orderId: old.orderId, sellerId: old.sellerId,
          actorUid, action: patch.paymentStatus === 'Paid' ? 'MANUAL_PAYMENT_VERIFIED' : 'PAYMENT_REJECTED',
          previousStatus: old.paymentStatus, newStatus: patch.paymentStatus, atIso: now,
          ...(patch.paymentStatus === 'Paid' && patch.attestation ? { attestation: patch.attestation } : {}),
          ...(patch.paymentStatus === 'Refunded' ? { refundReference: patch.refundReference ?? null } : {}) };
        next.paymentAudit = [...(Array.isArray(old.paymentAudit) ? old.paymentAudit : []), audit];
        next.updatedAtIso = now;
        tx.set(ledgerRef, next);
        tx.set(orderRef, { paymentStatus: next.paymentStatus, verificationMode: next.verificationMode,
          commissionStatus: next.commissionStatus, payoutStatus: next.payoutStatus,
          verifiedByUid: next.verifiedByUid || null, verifiedAtIso: next.verifiedAtIso || null,
          refundedAtIso: next.refundedAtIso || null, refundReference: next.refundReference || null,
          downloadTokenId: next.downloadTokenId, updatedAt: new Date(), paymentReference: old.paymentReference }, { merge: true });
        tx.create(db.collection('ledger_audit').doc(audit.auditId), audit);
        if (patch.paymentStatus === 'Paid' && commissionSnap && !commissionSnap.exists) tx.create(commissionRef, commissionEntry(next));
        if (patch.paymentStatus === 'Refunded' && commissionSnap?.exists) {
          tx.set(commissionRef, { status: 'reversed', reversedAtIso: now, updatedAtIso: now }, { merge: true });
          if (adjustmentSnap && !adjustmentSnap.exists) tx.create(adjustmentRef, {
            adjustmentId: `${orderNumber}:refund`, orderNumber, orderId: old.orderId, sellerId: old.sellerId,
            currency: old.currency, amountMinor: -Number(old.platformCommissionMinor || 0),
            reason: 'order_refunded', refundReference: patch.refundReference, actorUid, createdAtIso: now,
          });
        }
        if (invoiceRef && invoiceSnap) {
          if (!invoiceSnap.exists || invoiceAdjSnap?.exists) throw new ApiError(409, 'orders/refund-reconcile-failed', 'Refund could not be safely reconciled with its commission invoice. Nothing was changed.');
          const invoice = invoiceSnap.data() || {};
          const original = Number(old.platformCommissionMinor || 0);
          if (invoice.sellerId !== old.sellerId || invoice.currency !== old.currency || !Array.isArray(invoice.orderNumbers) ||
              !invoice.orderNumbers.includes(orderNumber) || !Number.isSafeInteger(original) || original < 0 || !Number.isSafeInteger(invoice.remainingBalanceMinor)) {
            throw new ApiError(409, 'orders/refund-reconcile-failed', 'Refund could not be safely reconciled with its commission invoice. Nothing was changed.');
          }
          // Reduce only what is still owed; anything already paid becomes an auditable credit, never silently lost.
          const reduction = Math.min(invoice.remainingBalanceMinor, original);
          const remaining = invoice.remainingBalanceMinor - reduction;
          const status = remaining === 0 ? (Number(invoice.paidAmountMinor) > 0 ? 'paid' : 'voided') : invoice.status;
          tx.update(invoiceRef, { adjustedAmountMinor: Number(invoice.adjustedAmountMinor || 0) + original, remainingBalanceMinor: remaining, status });
          tx.create(db.collection('commission_adjustments').doc(invoiceAdjId), { adjustmentId: invoiceAdjId, invoiceId, invoiceNumber: invoice.invoiceNumber,
            orderNumber, sellerId: old.sellerId, currency: old.currency, adjustmentAmountMinor: original, creditDueMinor: original - reduction,
            reason: 'order_refunded', detail: 'Reversal of platform commission on refunded order.', refundReference: patch.refundReference ?? null, actorUid, createdAtIso: now });
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
        if (order.buyerId !== buyerUid || order.primaryProductId !== productId || order.paymentStatus !== 'Paid' ||
            order.commissionStatus === 'reversed' || Number(order.expiresAtMs) <= Date.now() ||
            Number(order.downloadCount || 0) >= Number(order.maxDownloads || 5) || order.downloadTokenId !== tokenId) {
          throw new ApiError(403, 'downloads/not-authorized', 'Order is unpaid, revoked, expired, exhausted or does not match this Buyer.');
        }
        const deliverableRef = db.collection('products').doc(productId).collection('deliverables').doc('main');
        const deliverableSnap = await tx.get(deliverableRef);
        if (!deliverableSnap.exists || deliverableSnap.get('ownerId') !== order.sellerId || deliverableSnap.get('productId') !== productId) throw new ApiError(404, 'downloads/file-not-found', 'Original product file is unavailable.');
        const deliverable = deliverableSnap.data() || {};
        const fileRef = String(deliverable.fileDataUrl || '');
        const path = fileRef.startsWith('storage://') ? fileRef.slice('storage://'.length) : '';
        const prefix = `deliverables/${order.sellerId}/${productId}/`;
        if (!path.startsWith(prefix) || path.includes('..') || path.slice(prefix.length).includes('/')) throw new ApiError(403, 'downloads/file-invalid', 'Protected product file reference is invalid.');
        const file = bucket.file(path);
        try {
          const [[bytes], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
          const contentType = String(metadata.contentType || deliverable.fileMimeType || 'application/octet-stream');
          if (metadata.metadata?.firebaseStorageDownloadTokens) throw new ApiError(403, 'downloads/public-file-rejected', 'The stored original is not private.');
          validateFileMetadata(String(deliverable.fileName || ''), contentType, Number(metadata.size), 'product');
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
