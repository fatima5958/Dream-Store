import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { V2Dependencies } from '../contracts.ts';
import { ApiError } from '../errors.ts';
import { authenticatedPrincipal, isVerifiedSuperAdmin } from './auth.ts';
import { createDownloadToken } from './checkout.ts';
import { statusSummary } from './commission-settlements.ts';
import { requireSeller } from './policy.ts';

export function registerOrderRoutes(app: Express, deps: V2Dependencies) {
  const list = (req: any, res: any, next: any) => (async () => {
    const principal = await authenticatedPrincipal(req, deps);
    const admin = isVerifiedSuperAdmin(principal, deps.adminUid);
    const rows = await deps.finance!.listOrders(principal.uid, admin);
    const orders = rows.map(order => ({ id: order.orderId, orderId: order.orderId, orderNumber: order.orderNumber,
      storeId: order.storeId, sellerId: order.sellerId, buyerId: order.buyerId, primaryProductId: order.primaryProductId,
      customerName: order.customerName, customerEmail: order.customerEmail, productTitle: order.itemTitlesSummary,
      itemTitlesSummary: order.itemTitlesSummary, itemCount: order.itemCount, currency: order.currency,
      subtotal: order.subtotal, totalAmount: order.totalAmount, paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus, paymentReference: order.paymentReference,
      downloadToken: order.paymentStatus === 'Paid' && order.buyerId === principal.uid ? createDownloadToken(order, deps.downloadTokenSecret || '') : 'LOCKED-UNTIL-PAYMENT-VERIFIED',
      downloadCount: order.downloadCount || 0, maxDownloads: order.maxDownloads || 5, expiresAtMs: order.expiresAtMs,
      verificationMode: order.verificationMode, commissionStatus: order.commissionStatus, payoutStatus: order.payoutStatus,
      verifiedByUid: order.verifiedByUid, verifiedAtIso: order.verifiedAtIso, paymentEvidence: order.paymentEvidence || null,
      commissionBreakdown: { currency: order.currency, commissionRateBps: order.commissionRateBps,
        grossAmountMinor: order.grossAmountMinor, platformCommissionMinor: order.platformCommissionMinor,
        sellerShareBeforeFeesMinor: order.sellerShareBeforeFeesMinor, gatewayFeeMinor: order.gatewayFeeMinor,
        sellerNetEarningsMinor: order.sellerNetEarningsMinor } }));
    const audits = rows.flatMap(order => Array.isArray(order.paymentAudit) ? order.paymentAudit : []);
    const profile = principal.emailVerified ? await deps.profiles.find(principal) : null;
    const commissionSummary = profile?.role === 'seller' && deps.finance?.commissionRecords
      ? await statusSummary(principal.uid, deps.finance) : undefined;
    res.json({ orders, audits, ...(commissionSummary ? { commissionSummary } : {}) });
  })().catch(next);
  app.get('/api/orders/list', list); app.get('/api/orders/sync', list);
  app.post('/api/orders/refund', (req, res, next) => (async () => {
    const principal = await authenticatedPrincipal(req, deps);
    await requireSeller(principal, deps);
    const orderNumber = String(req.body?.orderNumber || '').trim();
    const order = await deps.finance!.order(orderNumber);
    if (!order) throw new ApiError(404, 'orders/not-found', 'Order not found.');
    if (order.sellerId !== principal.uid) throw new ApiError(403, 'orders/seller-forbidden', 'Only the Seller who owns this order may record a refund.');
    const refundReference = String(req.body?.refundReference || '').trim();
    if (req.body?.refundConfirmed !== true || refundReference.length < 3 || refundReference.length > 200) throw new ApiError(422, 'orders/refund-evidence-required', 'Confirm that funds were returned and provide the real refund transaction reference.');
    const changed = await deps.finance!.transitionOrder(orderNumber, 'Paid', {
      paymentStatus: 'Refunded', commissionStatus: 'reversed', payoutStatus: 'Reversed (Refunded)',
      refundedAtIso: new Date().toISOString(), refundReference, updatedAtIso: new Date().toISOString(),
      downloadTokenId: randomUUID(),
    }, principal.uid);
    res.json({ ok: true, orderNumber, orderId: changed.orderId, paymentStatus: changed.paymentStatus,
      commissionStatus: changed.commissionStatus, payoutStatus: changed.payoutStatus });
  })().catch(next));
}
