// Pure commission lifecycle rules. Stored V1 statuses are NEVER rewritten:
// these functions add an explicit, read-only `lifecycleStatus` next to them.

export const INVOICE_SALES_THRESHOLD = 5;
export const INVOICE_PAYMENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const RESTRICTED_FEATURES_ON_OVERDUE = ['add_product', 'publish_product', 'visual_store_builder', 'theme_customization'];
export const UNRESTRICTED_FEATURES_ALWAYS = [
  'public_storefront_visibility', 'existing_product_purchases', 'buyer_checkout', 'payment_processing',
  'existing_orders', 'digital_product_downloads', 'seller_access_to_orders',
  'seller_access_to_commission_payments', 'customer_support_and_refunds',
];

export type LifecycleStatus =
  | 'not_applicable' | 'outstanding' | 'proof_submitted' | 'settled' | 'rejected' | 'disputed' | 'reversed';

/** Invoice (stored: open | overdue | payment_submitted | paid | voided). */
export function invoiceLifecycle(status: string, remainingMinor: number, paidMinor: number): LifecycleStatus {
  if (status === 'voided') return 'reversed';
  if (status === 'paid' || (Number(remainingMinor) <= 0 && Number(paidMinor) > 0)) return 'settled';
  if (Number(remainingMinor) <= 0) return 'reversed'; // fully adjusted away by refunds, nothing paid
  if (status === 'payment_submitted') return 'proof_submitted';
  return 'outstanding'; // open or overdue (overdue is a deadline flag, not a separate money state)
}

/** Seller proof (stored: submitted | verified | rejected). Admin review is a single decision step. */
export function paymentLifecycle(status: string): LifecycleStatus {
  if (status === 'verified') return 'settled';
  if (status === 'rejected') return 'rejected';
  return 'proof_submitted';
}

/** Ledger entry commission (stored: not_applicable | outstanding | paid | reversed | disputed). */
export function ledgerCommissionLifecycle(status: string): LifecycleStatus {
  switch (status) {
    case 'paid': return 'settled';
    case 'reversed': return 'reversed';
    case 'disputed': return 'disputed';
    case 'not_applicable': return 'not_applicable';
    default: return 'outstanding';
  }
}

/**
 * Wording guard: a Seller clicking "I confirm payment" is a manual attestation, never bank or
 * gateway verification. Only a trusted provider integration may ever produce 'Gateway Verified'.
 */
export const MANUAL_ATTESTATION_LABEL = 'Manually Verified by Seller';
