import { randomUUID } from 'node:crypto';
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
    if (status === 'Paid' && req.body?.statementConfirmed !== true) throw new ApiError(422, 'orders/evidence-required', 'Confirm that external bank or wallet evidence was independently reviewed.');
    if (status === 'Paid') {
      const declaredMethod = String(req.body?.declaredPaymentMethod || order.paymentMethod || '').trim();
      if (declaredMethod !== String(order.paymentMethod || '') || String(order.paymentReference || '').trim().length < 3) {
        throw new ApiError(409, 'orders/evidence-mismatch', 'The submitted payment method/reference does not match the saved order.');
      }
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
      paymentEvidence: { kind: 'seller_attestation', reference: String(order.paymentReference).trim().slice(0, 160),
        declaredPaymentMethod: String(order.paymentMethod), amountMinor: Number(order.grossAmountMinor), currency: String(order.currency),
        attestedByUid: principal.uid, attestedAtIso: now, externalProviderVerified: false } } : { paymentStatus: 'Failed',
      verificationMode: 'Unverified', commissionStatus: 'reversed', payoutStatus: 'Failed', updatedAtIso: now,
      downloadTokenId: randomUUID() };
    const changed = await deps.finance!.transitionOrder(orderNumber, 'Pending', next, principal.uid);
    let commissionBillingWarning: string | null = null;
    if (status === 'Paid' && Number(changed.grossAmountMinor) > 0 && deps.finance!.issueCommissionInvoices) {
      try { await deps.finance!.issueCommissionInvoices(principal.uid); }
      catch { commissionBillingWarning = 'Order verification was saved; invoice issuance needs a safe retry.'; }
    }
    res.json({ ok: true, orderNumber, orderId: changed.orderId, paymentStatus: changed.paymentStatus,
      verificationMode: changed.verificationMode, commissionStatus: changed.commissionStatus, payoutStatus: changed.payoutStatus,
      downloadToken: changed.paymentStatus === 'Paid' ? createDownloadToken(changed, deps.downloadTokenSecret || '') : 'LOCKED-UNTIL-PAYMENT-VERIFIED',
      verifiedByUid: changed.verifiedByUid, verifiedAtIso: changed.verifiedAtIso,
      paymentEvidence: changed.paymentEvidence, commissionBillingWarning });
  })().catch(next));
}
