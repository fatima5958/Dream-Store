import { createHash } from 'node:crypto';

export function checkoutRequestHash(order: Record<string, any>): string {
  return createHash('sha256').update(JSON.stringify({
    buyerId: order.buyerId, sellerId: order.sellerId, storeId: order.storeId,
    primaryProductId: order.primaryProductId, currency: order.currency,
    grossAmountMinor: order.grossAmountMinor, paymentMethod: order.paymentMethod,
    paymentReference: String(order.paymentReference || '').trim().toUpperCase(),
    customerName: String(order.customerName || ''),
    customerEmail: String(order.customerEmail || '').trim().toLowerCase(),
  })).digest('hex');
}

export function checkoutResponse(order: Record<string, any>) {
  const amount = order.totalAmount ?? order.grossAmountMinor / 100;
  return { orderId: order.orderId, orderNumber: order.orderNumber, storeId: order.storeId, sellerId: order.sellerId,
    calculatedSubtotal: amount, calculatedTotal: amount, currency: order.currency,
    initialPaymentStatus: order.paymentStatus, verificationMode: order.verificationMode,
    commissionStatus: order.commissionStatus,
    downloadToken: order.paymentStatus === 'Paid' ? order.downloadToken : 'LOCKED-PENDING-VERIFICATION',
    downloadCount: order.downloadCount, maxDownloads: order.maxDownloads, expiresAtMs: order.expiresAtMs,
    commissionBreakdown: { currency: order.currency, commissionRateBps: order.commissionRateBps,
      grossAmountMinor: order.grossAmountMinor, platformCommissionMinor: order.platformCommissionMinor,
      sellerShareBeforeFeesMinor: order.sellerShareBeforeFeesMinor, gatewayFeeMinor: order.gatewayFeeMinor,
      sellerNetEarningsMinor: order.sellerNetEarningsMinor }, payoutStatus: order.payoutStatus,
    gatewayNotice: amount === 0 ? 'Free digital product verified. Instant download unlocked.'
      : order.paymentStatus === 'Paid' ? 'Payment verified. Your order is available in your account.'
      : 'Order recorded pending Seller payment verification. A transaction reference is not proof of payment.',
  };
}
