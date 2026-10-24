// Commission collection is a separate Seller/platform obligation. Only the
// Buyer's payment/refund status, expiry and usage determine file entitlement.
export function canDownload(order: Record<string, any>, now = Date.now()): boolean {
  return order.paymentStatus === 'Paid' && Number.isSafeInteger(order.expiresAtMs) && order.expiresAtMs > now &&
    Number.isSafeInteger(order.downloadCount) && order.downloadCount >= 0 &&
    Number.isSafeInteger(order.maxDownloads) && order.maxDownloads > 0 && order.downloadCount < order.maxDownloads;
}
