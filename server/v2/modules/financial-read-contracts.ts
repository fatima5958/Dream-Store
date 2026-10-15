import type { Express } from 'express';
import type { V2Dependencies } from '../contracts.ts';
import { ApiError } from '../errors.ts';
import { authenticatedPrincipal, isVerifiedSuperAdmin } from './auth.ts';
import { requireSeller } from './policy.ts';

const money = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;

export function registerFinancialReadRoutes(app: Express, deps: V2Dependencies) {
  app.get(['/api/ledger', '/api/ledger/transactions'], (req: any, res: any, next: any) => (async () => {
    const principal = await authenticatedPrincipal(req, deps);
    const isAdmin = isVerifiedSuperAdmin(principal, deps.adminUid);
    const requestedSellerId = String(req.query.sellerId || req.query.ownerId || '').trim();
    const storeId = String(req.query.storeId || '').trim();
    if (requestedSellerId && !/^[A-Za-z0-9_-]{1,128}$/.test(requestedSellerId)) throw new ApiError(400, 'ledger/invalid-seller', 'Seller identity is invalid.');
    if (storeId && !/^[A-Za-z0-9_-]{1,128}$/.test(storeId)) throw new ApiError(400, 'ledger/invalid-store', 'Store identity is invalid.');
    if (!isAdmin) {
      await requireSeller(principal, deps);
      if (requestedSellerId && requestedSellerId !== principal.uid) throw new ApiError(403, 'ledger/owner-forbidden', 'You cannot read another Seller ledger.');
      if (storeId) {
        if (!deps.stores) throw new ApiError(503, 'ledger/store-unavailable', 'Store ownership cannot be verified.');
        const store = await deps.stores.find(storeId);
        if (!store) throw new ApiError(404, 'ledger/store-not-found', 'Store not found.');
        if (store.ownerId !== principal.uid) throw new ApiError(403, 'ledger/store-forbidden', 'You cannot read another Seller ledger.');
      }
    }
    if (!deps.finance?.ledgerEntries) throw new ApiError(501, 'ledger/not-migrated', 'Ledger reads are unavailable in this V2 environment.');
    const rawLimit = req.query.limit === undefined ? 100 : Number(req.query.limit);
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 200) throw new ApiError(400, 'ledger/invalid-limit', 'Limit must be an integer from 1 to 200.');
    const cursor = String(req.query.cursor || '').trim();
    if (cursor && !/^[A-Za-z0-9_-]{1,128}$/.test(cursor)) throw new ApiError(400, 'ledger/invalid-cursor', 'Cursor is invalid.');
    const sellerId = isAdmin ? requestedSellerId || undefined : principal.uid;
    const result = await deps.finance.ledgerEntries(sellerId, isAdmin, storeId || undefined, cursor || undefined, rawLimit);
    const summary = result.entries.reduce((acc, row) => {
      if (row.paymentStatus === 'Paid') {
        acc.totalGrossVolumeMinor += money(row.grossAmountMinor);
        acc.totalSellerNetMinor += money(row.sellerNetEarningsMinor);
      }
      if (row.commissionStatus === 'outstanding') acc.outstandingCommissionTotalMinor += money(row.platformCommissionMinor);
      if (row.commissionStatus === 'paid') acc.collectedPlatformRevenueMinor += money(row.platformCommissionMinor);
      return acc;
    }, { outstandingCommissionTotalMinor: 0, collectedPlatformRevenueMinor: 0, totalGrossVolumeMinor: 0, totalSellerNetMinor: 0 });
    res.json({ platformCommissionBps: 500, entries: result.entries,
      auditTrail: isAdmin ? result.auditTrail : [], summary,
      pageInfo: { limit: rawLimit, nextCursor: result.nextCursor, hasMore: result.hasMore } });
  })().catch(next));

  app.get('/api/orders/:orderNumber/email-notification', (req: any, res: any, next: any) => (async () => {
    const principal = await authenticatedPrincipal(req, deps);
    const orderNumber = String(req.params.orderNumber || '').trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(orderNumber)) throw new ApiError(400, 'orders/invalid-order-number', 'Order number is invalid.');
    if (!deps.finance?.emailNotification) throw new ApiError(501, 'orders/notifications-not-migrated', 'Order notification status is unavailable in this V2 environment.');
    const order = await deps.finance.emailNotification(orderNumber);
    if (!order) throw new ApiError(404, 'orders/not-found', 'Order not found.');
    const isAdmin = isVerifiedSuperAdmin(principal, deps.adminUid);
    if (!isAdmin && order.buyerId !== principal.uid && order.sellerId !== principal.uid) throw new ApiError(403, 'orders/notification-forbidden', 'You cannot view this order notification status.');
    const raw = order.notification && typeof order.notification === 'object' ? order.notification : null;
    const notification = raw ? { status: String(raw.status || 'unknown'),
      sentAtIso: typeof raw.sentAtIso === 'string' ? raw.sentAtIso : null,
      deliveryProvider: typeof raw.deliveryProvider === 'string' ? raw.deliveryProvider : null } : null;
    res.json({ orderNumber, paymentStatus: order.paymentStatus,
      emailSent: Boolean(notification && notification.status === 'sent'),
      emailNotification: notification, deliveryConfigured: false,
      message: notification?.status === 'sent' ? 'Previously recorded delivery status.' : 'Automatic order email delivery is not configured.' });
  })().catch(next));

  app.get('/api/payments/payoneer-readiness', (_req, res) => res.json({
    payoneerLiveConfigured: false, payoneerApiEnabled: false, allEnvVarsOptional: true,
    dummyCredentialsRequired: false, manualVerificationPreserved: true, mode: 'manual_settlement',
    environment: 'disabled', hasClientId: false, hasClientSecret: false, hasProgramId: false,
    hasWebhookSecret: false, supportedFlows: ['seller_5pct_commission_settlement_via_payoneer'],
    statusLabel: 'Payoneer API Disabled — Manual Settlement Only',
  }));
}
