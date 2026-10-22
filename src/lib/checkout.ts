interface CheckoutIntent {
  buyerId: string;
  storeId: string;
  productId: string;
  quantity: number;
  currency: string;
  paymentMethod: string;
  paymentReference: string;
  customerName: string;
  customerEmail: string;
}

type AttemptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const memoryAttempts = new Map<string, string>();
function tabStorage(): AttemptStorage | undefined {
  try { return globalThis.sessionStorage; } catch { return undefined; }
}

// Keep the same opaque key when a response is lost, including after a tab reload.
// Storage contains only an intent hash and random key, never receiving details or PII.
export async function checkoutAttempt(intent: CheckoutIntent, storage = tabStorage()) {
  const encoded = new TextEncoder().encode(JSON.stringify([intent.buyerId, intent.storeId, intent.productId,
    intent.quantity, intent.currency, intent.paymentMethod, intent.paymentReference.trim().toUpperCase(),
    intent.customerName, intent.customerEmail.trim().toLowerCase()]));
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoded))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const storageKey = 'dreamstore_checkout_attempt_v1:' + hash;
  let key = memoryAttempts.get(storageKey);
  try { key = storage?.getItem(storageKey) || key; } catch { /* In-memory retries still work. */ }
  if (!key || !/^checkout-[A-Za-z0-9_-]{8,180}$/.test(key)) key = 'checkout-' + crypto.randomUUID();
  memoryAttempts.set(storageKey, key);
  try { storage?.setItem(storageKey, key); } catch { /* Private browsers may block storage. */ }
  return { key, complete() {
    memoryAttempts.delete(storageKey);
    try { storage?.removeItem(storageKey); } catch { /* No persistent attempt to clear. */ }
  } };
}

export function applyDownloadReceipt<T extends { downloadCount: number; downloadToken: string }>(
  order: T, receipt: { downloadCount: number; nextDownloadToken?: string },
): T {
  // A slower request must not overwrite a newer poll/download result.
  if (!Number.isSafeInteger(receipt.downloadCount) || receipt.downloadCount < order.downloadCount) return order;
  return { ...order, downloadCount: receipt.downloadCount,
    downloadToken: receipt.nextDownloadToken || order.downloadToken };
}

export function mergeOrderSnapshot<T extends { downloadCount: number; downloadToken: string; paymentStatus: string }>(
  existing: T | undefined, incoming: T,
): T {
  if (existing?.paymentStatus === 'Paid' && incoming.paymentStatus === 'Paid' &&
      existing.downloadCount > incoming.downloadCount) {
    return { ...incoming, downloadCount: existing.downloadCount, downloadToken: existing.downloadToken };
  }
  // Refund/rejection snapshots always replace the old entitlement.
  return incoming;
}
