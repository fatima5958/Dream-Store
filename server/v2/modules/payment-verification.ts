import { createHash, randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { V2Dependencies } from '../contracts.ts';
import { ApiError } from '../errors.ts';
import { authenticatedPrincipal } from './auth.ts';
import { createDownloadToken } from './checkout.ts';
import { commissionBreakdown } from './commissions.ts';
import { requireSeller } from './policy.ts';

export function registerPaymentVerificationRoutes(app: Express, deps: V2Dependencies) {
  app.post('/api/orders/verify-payment', (req, res, next) => (async () => {
    const principal = await authenticatedPrincipal(req, deps);
    await requireSeller(principal, deps);
    if (!principal.emailVerified) throw new ApiError(403, 'auth/email-not-verified', 'Verify your email first.');
    const orderNumber = String(req.body?.orderNumber || '').trim();
    const status = req.body?.newStatus;
    if (!['Paid', 'Failed'].includes(status)) throw new ApiError(422, 'orders/invalid-payment-status', 'Invalid payment verification status.');
    const order = await deps.finance!.order(orderNumber);
    if (!order) throw new ApiError(404, 'orders/not-found', 'Order not found.');
    if (order.sellerId !== principal.uid) throw new ApiError(403, 'orders/seller-forbidden', 'Only the Seller who owns this order may verify payment.');
    if (order.buyerId === principal.uid) throw new ApiError(403, 'orders/self-approval', 'Buyers cannot verify their own payment.');
    const evidenceType = String(req.body?.evidenceType ?? 'unspecified');
    if (!['unspecified', 'bank_statement', 'wallet_statement', 'payment_app', 'other'].includes(evidenceType)) throw new ApiError(422, 'orders/invalid-evidence-type', 'Unsupported evidence type.');
    const receivedRaw = req.body?.receivedAmountMinor;
    if (receivedRaw !== undefined && receivedRaw !== null && (!Number.isSafeInteger(receivedRaw) || receivedRaw !== order.grossAmountMinor)) {
      throw new ApiError(409, 'orders/amount-mismatch', 'The amount you received does not match the order total. Nothing was recorded.');
    }
    if (status === 'Paid' && req.body?.statementConfirmed !== true) throw new ApiError(422, 'orders/evidence-required', 'Confirm that external bank or wallet evidence was independently reviewed.');
    if (status === 'Paid') {
      const expected = commissionBreakdown(Number(order.grossAmountMinor), String(order.currency), String(order.paymentMethod));
      if (!Number.isSafeInteger(order.grossAmountMinor) || Math.round(Number(order.totalAmount) * 100) !== order.grossAmountMinor ||
          order.commissionRateBps !== 500 || order.platformCommissionMinor !== expected.platformCommissionMinor ||
          !String(order.paymentReference || '').trim() || order.paymentStatus !== 'Pending') {
        throw new ApiError(409, 'orders/financial-snapshot-invalid', 'Saved amount, currency, commission or payment status needs review.');
      }
    }
    const now = new Date().toISOString();
    const next = status === 'Paid' ? { paymentStatus: 'Paid', verificationMode: 'Manually Verified by Seller',
      commissionStatus: order.grossAmountMinor > 0 ? 'outstanding' : 'not_applicable',
      payoutStatus: 'Direct Manual Receipt by Seller (5% Commission Outstanding)', verifiedByUid: principal.uid,
      verifiedAtIso: now, updatedAtIso: now, downloadTokenId: randomUUID(),
      // A Seller's own statement. Never labelled bank- or gateway-verified. The note text itself is deliberately not stored.
      attestation: { statement: 'seller_manual_attestation_v1', attestedByUid: principal.uid, attestedAtIso: now, evidenceType,
        declaredPaymentMethod: String(order.paymentMethod), paymentReferenceHash: createHash('sha256').update(String(order.paymentReference).trim().toUpperCase()).digest('hex'),
        receivedAmountMinor: Number.isSafeInteger(receivedRaw) ? receivedRaw : null, evidenceNoteProvided: typeof req.body?.evidenceNote === 'string' && req.body.evidenceNote.trim().length > 0 } } : { paymentStatus: 'Failed',
      verificationMode: 'Unverified', commissionStatus: 'reversed', payoutStatus: 'Failed', updatedAtIso: now,
      downloadTokenId: randomUUID() };
    const changed = await deps.finance!.transitionOrder(orderNumber, 'Pending', next, principal.uid);
    if (changed.paymentStatus === 'Paid' && changed.commissionStatus === 'outstanding') {
      // Best effort and idempotent: a failure here never undoes a recorded verification; the next verification re-attempts it.
      try { await deps.commissions?.issueInvoices(String(changed.sellerId)); }
      catch (error) { console.warn('[DreamStore V2] invoice issuance deferred', { code: (error as { code?: unknown })?.code ?? 'unclassified' }); }
    }
    res.json({ ok: true, orderNumber, orderId: changed.orderId, paymentStatus: changed.paymentStatus,
      verificationMode: changed.verificationMode, commissionStatus: changed.commissionStatus, payoutStatus: changed.payoutStatus,
      downloadToken: changed.paymentStatus === 'Paid' ? createDownloadToken(changed, deps.downloadTokenSecret || '') : 'LOCKED-UNTIL-PAYMENT-VERIFIED',
      verifiedByUid: changed.verifiedByUid, verifiedAtIso: changed.verifiedAtIso });
  })().catch(next));
}
