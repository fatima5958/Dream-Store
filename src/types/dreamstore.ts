export type ScreenId =
  | 'landing'
  | 'wizard'
  | 'owner-dashboard'
  | 'storefront'
  | 'shop'
  | 'product-detail'
  | 'visual-editor'
  | 'mobile-designs'
  | 'super-admin'
  | 'checkout';

export type CurrencyCode =
  | 'USD'
  | 'PKR'
  | 'INR'
  | 'GBP'
  | 'EUR'
  | 'AED'
  | 'SAR'
  | 'CAD'
  | 'AUD';

export const CURRENCY_META: Record<
  CurrencyCode,
  { symbol: string; name: string; rateFromUsd: number; minorExponent: number }
> = {
  USD: { symbol: '$', name: 'US Dollar', rateFromUsd: 1, minorExponent: 2 },
  PKR: { symbol: 'Rs ', name: 'Pakistani Rupee', rateFromUsd: 278, minorExponent: 2 },
  INR: { symbol: '₹', name: 'Indian Rupee', rateFromUsd: 84, minorExponent: 2 },
  GBP: { symbol: '£', name: 'British Pound', rateFromUsd: 0.78, minorExponent: 2 },
  EUR: { symbol: '€', name: 'Euro', rateFromUsd: 0.92, minorExponent: 2 },
  AED: { symbol: 'AED ', name: 'UAE Dirham', rateFromUsd: 3.67, minorExponent: 2 },
  SAR: { symbol: 'SAR ', name: 'Saudi Riyal', rateFromUsd: 3.75, minorExponent: 2 },
  CAD: { symbol: 'CA$', name: 'Canadian Dollar', rateFromUsd: 1.38, minorExponent: 2 },
  AUD: { symbol: 'A$', name: 'Australian Dollar', rateFromUsd: 1.52, minorExponent: 2 },
};

export type PaymentMethodId =
  | 'free_instant'
  | 'jazzcash'
  | 'easypaisa'
  | 'upi_india'
  | 'razorpay_inr'
  | 'stripe_card'
  | 'payoneer'
  | 'manual_bank';

export type OrderPaymentStatus = 'Pending' | 'Paid' | 'Failed' | 'Refunded';

export type VerificationMode =
  | 'Unverified'
  | 'Instant Free'
  | 'Manually Verified by Seller'
  | 'Gateway Verified';

export type CommissionStatus =
  | 'not_applicable'
  | 'outstanding'
  | 'paid'
  | 'reversed'
  | 'disputed';

export type PayoutStatus =
  | 'Not Applicable (Free)'
  | 'Pending Payment Verification'
  | 'Direct Manual Receipt by Seller (5% Commission Outstanding)'
  | 'Unsettled (Launch Blocker: Live Split Payout API Not Connected)'
  | 'Reversed (Refunded)';

export interface LedgerAuditEntry {
  auditId: string;
  orderNumber: string;
  orderId: string;
  sellerId: string;
  actorUid: string;
  action:
    | 'ORDER_CREATED'
    | 'MANUAL_PAYMENT_VERIFIED'
    | 'BUYER_PAID_EMAIL_TRIGGERED'
    | 'PAYMENT_REJECTED'
    | 'ORDER_REFUNDED_REVERSED'
    | 'COMMISSION_DISPUTED'
    | 'COMMISSION_SETTLED'
    | 'INVOICE_GENERATED'
    | 'INVOICE_OVERDUE_RESTRICTED'
    | 'COMMISSION_PAYMENT_SUBMITTED'
    | 'COMMISSION_PAYMENT_VERIFIED'
    | 'COMMISSION_PAYMENT_REJECTED'
    | 'COMMISSION_ADJUSTED';
  previousStatus: string;
  newStatus: string;
  verificationMode: string;
  detail: string;
  createdAtIso: string;
}

export type CommissionInvoiceStatus =
  | 'open'
  | 'overdue'
  | 'payment_submitted'
  | 'paid'
  | 'voided';

export type RestrictedSellerFeature =
  | 'add_product'
  | 'publish_product'
  | 'visual_store_builder'
  | 'theme_customization';

export interface CommissionInvoice {
  invoiceId: string;
  invoiceNumber: string;
  sellerId: string;
  storeId: string;
  currency: CurrencyCode;
  orderNumbers: string[];
  verifiedSalesCount: number;
  grossSalesMinor: number;
  commissionAmountMinor: number;
  paidAmountMinor: number;
  adjustedAmountMinor: number;
  remainingBalanceMinor: number;
  status: CommissionInvoiceStatus;
  issuedAtMs: number;
  dueAtMs: number;
  issuedAtIso: string;
  dueAtIso: string;
  lastPaymentMethod?: string;
  lastPaymentReference?: string;
  lastPaymentProofNote?: string;
  submittedAtIso?: string;
  verifiedByAdminEmail?: string;
  verifiedAtIso?: string;
  serverSignature: string;
}

export interface CommissionPaymentRecord {
  paymentId: string;
  invoiceId: string;
  invoiceNumber: string;
  sellerId: string;
  storeId: string;
  currency: CurrencyCode;
  amountMinor: number;
  paymentMethod: string;
  paymentReference: string;
  proofNote: string;
  status: 'submitted' | 'verified' | 'rejected';
  submittedByUid: string;
  verifiedByAdminEmail?: string;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface CommissionAdjustmentRecord {
  adjustmentId: string;
  invoiceId: string;
  invoiceNumber: string;
  orderNumber: string;
  sellerId: string;
  currency: CurrencyCode;
  adjustmentAmountMinor: number;
  reason: 'order_refunded' | 'order_disputed';
  detail: string;
  createdAtIso: string;
}

export interface SellerCommissionStatusSummary {
  sellerId: string;
  storeId: string;
  currency: CurrencyCode;
  salesTowardNextInvoice: number;
  invoiceThreshold: number;
  totalVerifiedEligibleSales: number;
  unbilledOrderNumbers: string[];
  unbilledCommissionMinor: number;
  invoicedOutstandingMinor: number;
  totalOutstandingCommissionMinor: number;
  totalPaidCommissionMinor: number;
  totalAdjustedCommissionMinor: number;
  nextPaymentDeadlineMs: number | null;
  nextPaymentDeadlineIso: string | null;
  daysUntilDeadline: number | null;
  isRestricted: boolean;
  restrictionReason: string | null;
  restrictedFeatures: RestrictedSellerFeature[];
  unrestrictedFeatures: string[];
  invoices: CommissionInvoice[];
  payments: CommissionPaymentRecord[];
  adjustments: CommissionAdjustmentRecord[];
}

export interface CommissionBreakdown {
  currency: CurrencyCode;
  commissionRateBps: number; // e.g. 500 = 5.00%
  grossAmountMinor: number;
  platformCommissionMinor: number;
  gatewayFeeMinor: number;
  sellerShareBeforeFeesMinor: number; // e.g. 950 PKR on 1,000 PKR
  sellerNetEarningsMinor: number; // after gateway fees
}

export interface ProductFeature {
  title: string;
  subtitle: string;
  icon: 'pdf' | 'guide' | 'tools';
}

export interface Product {
  id: string;
  storeId?: string;
  ownerId?: string;
  title: string;
  category: 'Ebooks' | 'Workbooks' | 'Planners' | 'Templates' | 'Bundles';
  subtitle: string;
  description: string;
  whatsIncluded: string[];
  details: { label: string; value: string }[];
  price: number; // USD base price
  priceUsd: number;
  pricePkr: number;
  isFree: boolean;
  published: boolean;
  status: 'Available' | 'Coming Soon' | 'Draft';
  image: string;
  gallery: string[];
  features: ProductFeature[];
  fileName: string;
  fileType: string;
  fileSizeLabel: string;
  fileDataUrl?: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface BuyerEmailNotificationInfo {
  emailId: string;
  recipientEmail: string;
  subject: string;
  status: 'sent' | 'failed' | 'skipped';
  sentAtIso: string;
  deliveryProvider: 'resend_api' | 'secure_outbox';
  securitySignature: string;
}

export interface OrderItem {
  id: string;
  orderNumber: string;
  storeId: string;
  sellerId: string;
  buyerId: string;
  primaryProductId: string;
  customerName: string;
  customerEmail: string;
  productTitle: string;
  itemTitlesSummary: string;
  itemCount: number;
  currency: CurrencyCode;
  subtotal: number;
  totalAmount: number;
  amount: string;
  paymentMethod: PaymentMethodId;
  paymentStatus: OrderPaymentStatus;
  paymentReference: string;
  downloadToken: string;
  downloadCount: number;
  maxDownloads: number;
  expiresAtMs: number;
  date: string;
  status: 'Completed' | 'Processing';
  // Phase 4 & 5 Commission, Verification Mode & Refund fields (computed server-side / ledger)
  commissionBreakdown?: CommissionBreakdown;
  payoutStatus?: PayoutStatus;
  verificationMode?: VerificationMode;
  commissionStatus?: CommissionStatus;
  verifiedByUid?: string;
  verifiedAtIso?: string;
  buyerEmailNotification?: BuyerEmailNotificationInfo;
  refundRequested?: boolean;
  refundReason?: string;
}

export interface SellerPaymentSettings {
  ownerId: string;
  storeId?: string;
  email: string;
  jazzCashMerchantId: string;
  jazzCashEnabled: boolean;
  easypaisaStoreId: string;
  easypaisaEnabled: boolean;
  upiId?: string;
  paymentLinkUrl?: string;
  payoneerEnabled?: boolean;
  payoneerReceivingEmail?: string;
  payoneerRequestLink?: string;
  payoneerReceivingAccountDetails?: string;
  whatsappNotificationNumber?: string;
  whatsappNotificationsEnabled?: boolean;
  stripeAccountId: string;
  stripeEnabled: boolean;
  bankTransferInstructions: string;
  paymentConfigured?: boolean;
  configuredMethods?: PaymentMethodId[];
  setupMessage?: string;
}

const LEGACY_DEMO_PAYMENT_SUBSTRINGS = [
  '0300-1234567',
  '0345-9876543',
  'pk36mezn0001234567890102',
  'ananya.creates@okaxis',
  'rzp.io/l/ananya-creates-demo',
  'fatima.payouts@example.com',
  'payoneer.com/demo',
];

export function stripLegacyDemoPaymentValue(rawVal: unknown, maxLen = 1000): string {
  const str = String(rawVal || '').trim().slice(0, maxLen);
  if (!str) return '';
  const lower = str.toLowerCase();
  for (const demoSub of LEGACY_DEMO_PAYMENT_SUBSTRINGS) {
    if (lower.includes(demoSub)) {
      return '';
    }
  }
  return str;
}

export function getConfiguredSellerPaymentMethods(
  settings?: Partial<SellerPaymentSettings> | null,
  gatewayStatus?: GatewayServerStatus
): PaymentMethodId[] {
  if (!settings) return [];
  const methods: PaymentMethodId[] = [];
  const jazzId = stripLegacyDemoPaymentValue(settings.jazzCashMerchantId, 120);
  if (jazzId.length >= 3 && settings.jazzCashEnabled !== false) {
    methods.push('jazzcash');
  }
  const epId = stripLegacyDemoPaymentValue(settings.easypaisaStoreId, 120);
  if (epId.length >= 3 && settings.easypaisaEnabled !== false) {
    methods.push('easypaisa');
  }
  const upi = stripLegacyDemoPaymentValue(settings.upiId, 120);
  if (upi.length >= 3) {
    methods.push('upi_india');
  }
  const bank = stripLegacyDemoPaymentValue(settings.bankTransferInstructions, 1000);
  if (bank.length >= 5) {
    methods.push('manual_bank');
  }
  const payoneerActive =
    Boolean(settings.payoneerEnabled) &&
    Boolean(
      stripLegacyDemoPaymentValue(settings.payoneerReceivingEmail, 254).length >= 3 ||
        stripLegacyDemoPaymentValue(settings.payoneerRequestLink, 300).length >= 5 ||
        stripLegacyDemoPaymentValue(settings.payoneerReceivingAccountDetails, 500).length >= 5
    );
  if (payoneerActive) {
    methods.push('payoneer');
  }
  if (
    Boolean(gatewayStatus?.stripeConfigured) &&
    Boolean(settings.stripeEnabled) &&
    stripLegacyDemoPaymentValue(settings.stripeAccountId, 120).length >= 3
  ) {
    methods.push('stripe_card');
  }
  if (
    Boolean(gatewayStatus?.razorpayConfigured) &&
    stripLegacyDemoPaymentValue(settings.paymentLinkUrl, 300).length >= 5
  ) {
    methods.push('razorpay_inr');
  }
  return methods;
}

export interface GatewayServerStatus {
  paidCheckoutEnabled?: boolean;
  jazzcashConfigured: boolean;
  easypaisaConfigured: boolean;
  razorpayConfigured?: boolean;
  stripeConfigured: boolean;
  payoneerConfigured?: boolean;
  payoneerMode?: 'live_api' | 'manual_settlement';
  emailConfigured: boolean;
  platformCommissionBps?: number;
}

export interface PlatformStore {
  id: string;
  ownerId?: string;
  storeSlug?: string;
  storeName: string;
  ownerEmail: string;
  country?: string;
  currency?: CurrencyCode;
  instagramHandle?: string;
  status: 'Active' | 'Pending';
  plan: 'Pro' | 'Basic';
  created: string;
}

export interface StoreSection {
  id: string;
  name: string;
  visible: boolean;
  type: 'header' | 'hero' | 'products' | 'categories' | 'about' | 'newsletter' | 'footer';
}

export interface StoreConfig {
  storeId: string;
  ownerId: string;
  storeSlug: string;

  // Platform Landing Page Copy
  landingBrand: string;
  landingHeroLine1: string;
  landingHeroLine2: string;
  landingSubheading: string;
  landingCtaPrimary: string;
  landingCtaSecondary: string;

  // Store Setup & Identity
  storeName: string;
  ownerName: string;
  ownerRole: string;
  ownerEmail: string;
  ownerAvatar: string;
  logoUrl: string;
  sellerCountry: string;
  instagramHandle: string;
  socialWebsite: string;
  productType: string;
  theme: StoreThemeId;
  customAccentColor?: string;
  currency: CurrencyCode;
  exchangeRatePkr: number;

  // Storefront Copy
  announcementText: string;
  heroHeadingLine1: string;
  heroHeadingLine2: string;
  heroSubheading: string;
  heroButtonText: string;
  heroImage: string;

  // Store Sections for Visual Editor
  sections: StoreSection[];
}

export type StoreThemeId =
  | 'blush-bloom'
  | 'lavender-cloud'
  | 'vanilla-studio'
  | 'midnight-muse'
  | 'peach-petal'
  | 'clean-canvas'
  | 'blush-princess'
  | 'lavender-dreams'
  | 'vanilla-bloom'
  | 'rose-garden'
  | 'midnight-fairy'
  | 'minimal-muse'
  | 'blush-rose'
  | 'warm-cream'
  | 'petal-peach'
  | 'rosewood';

export interface StoreThemeDefinition {
  id:
    | 'blush-bloom'
    | 'lavender-cloud'
    | 'vanilla-studio'
    | 'midnight-muse'
    | 'peach-petal'
    | 'clean-canvas';
  slugAlias:
    | 'blush-princess'
    | 'lavender-dreams'
    | 'vanilla-bloom'
    | 'rose-garden'
    | 'midnight-fairy'
    | 'minimal-muse';
  name: string;
  legacyName?: string;
  tier: 'free' | 'pro';
  subtitle: string;
  swatches: string[];
  swatchClasses: string[];
  pageClass: string;
  headerClass: string;
  cardClass: string;
  mutedSurfaceClass: string;
  titleClass: string;
  mutedTextClass: string;
  accentTextClass: string;
  accentBadgeClass: string;
  buttonClass: string;
  secondaryButtonClass: string;
  heroOverlayClass: string;
  announcementClass: string;
  footerClass: string;
  headingFontClass: string;
  dividerClass: string;
  isDark: boolean;
}

export const CUSTOM_ACCENT_PRESETS: Array<{
  id: string;
  hex: string;
  label: string;
  name: string;
  swatchClass: string;
  accentTextClass: string;
  buttonClass: string;
}> = [
  {
    id: '#E879A8',
    hex: '#E879A8',
    label: 'Coquette Rose',
    name: 'Coquette Rose',
    swatchClass: 'bg-[#E879A8]',
    accentTextClass: 'text-[#C24B7E]',
    buttonClass:
      'bg-gradient-to-r from-[#E879A8] to-[#D86295] hover:from-[#D86295] hover:to-[#C24B7E] text-white',
  },
  {
    id: '#F472B6',
    hex: '#F472B6',
    label: 'Dreamy Pink',
    name: 'Dreamy Pink',
    swatchClass: 'bg-[#F472B6]',
    accentTextClass: 'text-[#DB2777]',
    buttonClass:
      'bg-gradient-to-r from-[#F472B6] to-[#E879A8] hover:from-[#E879A8] hover:to-[#DB2777] text-white',
  },
  {
    id: '#8B5CF6',
    hex: '#8B5CF6',
    label: 'Lavender Cloud',
    name: 'Lavender Cloud',
    swatchClass: 'bg-[#8B5CF6]',
    accentTextClass: 'text-[#6D28D9]',
    buttonClass:
      'bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] hover:from-[#7C3AED] hover:to-[#5B21B6] text-white',
  },
  {
    id: '#9A5B42',
    hex: '#9A5B42',
    label: 'Warm Vanilla Chai',
    name: 'Warm Vanilla Chai',
    swatchClass: 'bg-[#9A5B42]',
    accentTextClass: 'text-[#8C4F36]',
    buttonClass:
      'bg-gradient-to-r from-[#9A5B42] to-[#7C442F] hover:from-[#8C4F36] hover:to-[#693724] text-white',
  },
  {
    id: '#B85D78',
    hex: '#B85D78',
    label: 'Dusty Roseberry',
    name: 'Dusty Roseberry',
    swatchClass: 'bg-[#B85D78]',
    accentTextClass: 'text-[#9E4761]',
    buttonClass:
      'bg-gradient-to-r from-[#C86B85] to-[#A64B66] hover:from-[#B85D78] hover:to-[#8F3B54] text-white',
  },
  {
    id: '#3D2940',
    hex: '#3D2940',
    label: 'Deep Plum Ink',
    name: 'Deep Plum Ink',
    swatchClass: 'bg-[#3D2940]',
    accentTextClass: 'text-[#3D2940]',
    buttonClass: 'bg-[#3D2940] hover:bg-[#2B1C2D] text-white',
  },
];

export const STORE_THEMES: StoreThemeDefinition[] = [
  {
    id: 'blush-bloom',
    slugAlias: 'blush-princess',
    name: 'Blush Princess',
    legacyName: 'Blush Bloom',
    tier: 'free',
    subtitle: 'Dreamy pastel pink and pearl white with delicate coquette elegance.',
    swatches: ['#FFFAF6', '#F8BBD0', '#E879A8', '#3D2940'],
    swatchClasses: ['bg-[#FFFAF6]', 'bg-[#F8BBD0]', 'bg-[#E879A8]', 'bg-[#3D2940]'],
    pageClass: 'bg-[#FFFAF6] text-[#3D2940]',
    headerClass: 'bg-white/90 border-[#F8BBD0]/60',
    cardClass: 'bg-white border-[#F8BBD0]/65 text-[#3D2940]',
    mutedSurfaceClass: 'bg-[#FFF5F8] border-[#F8BBD0]/60 text-[#3D2940]',
    titleClass: 'text-[#3D2940]',
    mutedTextClass: 'text-[#826A7D]',
    accentTextClass: 'text-[#C24B7E]',
    accentBadgeClass: 'bg-[#FFF5F8] text-[#C24B7E] border-[#F8BBD0]',
    buttonClass:
      'bg-gradient-to-r from-[#E879A8] to-[#D86295] hover:from-[#D86295] hover:to-[#C24B7E] text-white shadow-sm',
    secondaryButtonClass:
      'bg-white hover:bg-[#FFF5F8] text-[#3D2940] border border-[#F8BBD0]',
    heroOverlayClass:
      'bg-gradient-to-r from-[#FFFAF6]/95 via-[#FFFAF6]/85 to-transparent',
    announcementClass:
      'bg-gradient-to-r from-[#FFF5F8] via-[#F6F3FF] to-[#FFF5F8] text-[#3D2940] border-[#F8BBD0]/60',
    footerClass: 'bg-white border-[#F8BBD0]/60 text-[#3D2940]',
    headingFontClass: 'font-serif-display',
    dividerClass: 'border-[#F8BBD0]/60',
    isDark: false,
  },
  {
    id: 'lavender-cloud',
    slugAlias: 'lavender-dreams',
    name: 'Lavender Dreams',
    legacyName: 'Lavender Cloud',
    tier: 'free',
    subtitle: 'Soft lavender mist and warm ivory with airy, dreamy serenity.',
    swatches: ['#FAF8FF', '#DCD0FF', '#8B5CF6', '#3D2940'],
    swatchClasses: ['bg-[#FAF8FF]', 'bg-[#DCD0FF]', 'bg-[#8B5CF6]', 'bg-[#3D2940]'],
    pageClass: 'bg-[#FAF8FF] text-[#3D2940]',
    headerClass: 'bg-white/90 border-[#DCD0FF]',
    cardClass: 'bg-white border-[#DCD0FF] text-[#3D2940]',
    mutedSurfaceClass: 'bg-[#F4F0FF] border-[#DCD0FF] text-[#3D2940]',
    titleClass: 'text-[#3D2940]',
    mutedTextClass: 'text-[#715E82]',
    accentTextClass: 'text-[#6D28D9]',
    accentBadgeClass: 'bg-[#F4F0FF] text-[#6D28D9] border-[#DCD0FF]',
    buttonClass:
      'bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] hover:from-[#7C3AED] hover:to-[#6D28D9] text-white shadow-sm',
    secondaryButtonClass:
      'bg-white hover:bg-[#F4F0FF] text-[#3D2940] border border-[#DCD0FF]',
    heroOverlayClass:
      'bg-gradient-to-r from-[#FAF8FF]/95 via-[#FAF8FF]/85 to-transparent',
    announcementClass:
      'bg-gradient-to-r from-[#F4F0FF] via-[#DCD0FF]/55 to-[#F4F0FF] text-[#3D2940] border-[#DCD0FF]',
    footerClass: 'bg-white border-[#DCD0FF] text-[#3D2940]',
    headingFontClass: 'font-serif-display',
    dividerClass: 'border-[#DCD0FF]',
    isDark: false,
  },
  {
    id: 'vanilla-studio',
    slugAlias: 'vanilla-bloom',
    name: 'Vanilla Bloom',
    legacyName: 'Vanilla Studio',
    tier: 'free',
    subtitle: 'Warm cream, soft oat beige, and refined editorial typography.',
    swatches: ['#FFFAF6', '#F3E9DF', '#A8644B', '#3D2940'],
    swatchClasses: ['bg-[#FFFAF6]', 'bg-[#F3E9DF]', 'bg-[#A8644B]', 'bg-[#3D2940]'],
    pageClass: 'bg-[#FFFAF6] text-[#2F2328]',
    headerClass: 'bg-[#FFFAF6]/95 border-[#E9DDD0]',
    cardClass: 'bg-white border-[#E9DDD0] text-[#2F2328]',
    mutedSurfaceClass: 'bg-[#F8F1EA] border-[#E9DDD0] text-[#2F2328]',
    titleClass: 'text-[#2F2328]',
    mutedTextClass: 'text-[#7A6760]',
    accentTextClass: 'text-[#96533B]',
    accentBadgeClass: 'bg-[#F8F1EA] text-[#96533B] border-[#E9DDD0]',
    buttonClass:
      'bg-gradient-to-r from-[#A8644B] to-[#8F4F37] hover:from-[#96533B] hover:to-[#783F2A] text-white shadow-sm',
    secondaryButtonClass:
      'bg-white hover:bg-[#F8F1EA] text-[#2F2328] border border-[#E9DDD0]',
    heroOverlayClass:
      'bg-gradient-to-r from-[#FFFAF6]/95 via-[#FFFAF6]/85 to-transparent',
    announcementClass: 'bg-[#F3E9DF] text-[#2F2328] border-[#E9DDD0]',
    footerClass: 'bg-white border-[#E9DDD0] text-[#2F2328]',
    headingFontClass: 'font-serif-display',
    dividerClass: 'border-[#E9DDD0]',
    isDark: false,
  },
  {
    id: 'peach-petal',
    slugAlias: 'rose-garden',
    name: 'Rose Garden',
    legacyName: 'Peach Petal',
    tier: 'pro',
    subtitle: 'Dusty rose, velvet berry, and deep plum romantic luxury.',
    swatches: ['#FFF7FA', '#F4C6D7', '#C85A82', '#3D2940'],
    swatchClasses: ['bg-[#FFF7FA]', 'bg-[#F4C6D7]', 'bg-[#C85A82]', 'bg-[#3D2940]'],
    pageClass: 'bg-[#FFF7FA] text-[#3D2940]',
    headerClass: 'bg-white/92 border-[#F4C6D7]',
    cardClass: 'bg-white border-[#F4C6D7] text-[#3D2940]',
    mutedSurfaceClass: 'bg-[#FDF0F5] border-[#F4C6D7] text-[#3D2940]',
    titleClass: 'text-[#3D2940]',
    mutedTextClass: 'text-[#7E5D6E]',
    accentTextClass: 'text-[#B2466E]',
    accentBadgeClass: 'bg-[#FDF0F5] text-[#B2466E] border-[#F4C6D7]',
    buttonClass:
      'bg-gradient-to-r from-[#C85A82] to-[#A83E65] hover:from-[#B2466E] hover:to-[#913054] text-white shadow-sm',
    secondaryButtonClass:
      'bg-white hover:bg-[#FDF0F5] text-[#3D2940] border border-[#F4C6D7]',
    heroOverlayClass:
      'bg-gradient-to-r from-[#FFF7FA]/95 via-[#FFF7FA]/85 to-transparent',
    announcementClass:
      'bg-gradient-to-r from-[#F4C6D7]/50 via-[#FFF7FA] to-[#F4C6D7]/50 text-[#3D2940] border-[#F4C6D7]',
    footerClass: 'bg-white border-[#F4C6D7] text-[#3D2940]',
    headingFontClass: 'font-serif-display',
    dividerClass: 'border-[#F4C6D7]',
    isDark: false,
  },
  {
    id: 'midnight-muse',
    slugAlias: 'midnight-fairy',
    name: 'Midnight Fairy',
    legacyName: 'Midnight Muse',
    tier: 'pro',
    subtitle: 'Deep plum night sky with glowing lavender & rose starlight.',
    swatches: ['#211526', '#3D2940', '#DCD0FF', '#F8BBD0'],
    swatchClasses: ['bg-[#211526]', 'bg-[#3D2940]', 'bg-[#DCD0FF]', 'bg-[#F8BBD0]'],
    pageClass: 'bg-[#211526] text-[#FFFAF6]',
    headerClass: 'bg-[#211526]/92 border-[#4B3352]',
    cardClass: 'bg-[#2D1E33] border-[#4B3352] text-[#FFFAF6]',
    mutedSurfaceClass: 'bg-[#382540] border-[#4B3352] text-[#FFFAF6]',
    titleClass: 'text-[#FFFAF6]',
    mutedTextClass: 'text-[#D8C7DE]',
    accentTextClass: 'text-[#F8BBD0]',
    accentBadgeClass: 'bg-[#382540] text-[#F8BBD0] border-[#593D61]',
    buttonClass:
      'bg-gradient-to-r from-[#E879A8] to-[#C24B7E] hover:from-[#D86295] hover:to-[#AD3B6C] text-white shadow-sm',
    secondaryButtonClass:
      'bg-[#382540] hover:bg-[#463050] text-[#FFFAF6] border border-[#593D61]',
    heroOverlayClass:
      'bg-gradient-to-r from-[#211526]/95 via-[#211526]/85 to-transparent',
    announcementClass:
      'bg-gradient-to-r from-[#2D1E33] via-[#3D2940] to-[#2D1E33] text-[#FFFAF6] border-[#4B3352]',
    footerClass: 'bg-[#1B1120] border-[#4B3352] text-[#FFFAF6]',
    headingFontClass: 'font-serif-display',
    dividerClass: 'border-[#4B3352]',
    isDark: true,
  },
  {
    id: 'clean-canvas',
    slugAlias: 'minimal-muse',
    name: 'Minimal Muse',
    legacyName: 'Clean Canvas',
    tier: 'pro',
    subtitle: 'Crisp pearl white and deep plum charcoal for effortless clarity.',
    swatches: ['#FFFFFF', '#FFFAF6', '#3D2940', '#826A7D'],
    swatchClasses: ['bg-white', 'bg-[#FFFAF6]', 'bg-[#3D2940]', 'bg-[#826A7D]'],
    pageClass: 'bg-white text-[#3D2940]',
    headerClass: 'bg-white/95 border-[#EDE4EA]',
    cardClass: 'bg-white border-[#EDE4EA] text-[#3D2940]',
    mutedSurfaceClass: 'bg-[#FFFAF6] border-[#EDE4EA] text-[#3D2940]',
    titleClass: 'text-[#3D2940]',
    mutedTextClass: 'text-[#826A7D]',
    accentTextClass: 'text-[#3D2940]',
    accentBadgeClass: 'bg-[#FFFAF6] text-[#3D2940] border-[#DFD2DC]',
    buttonClass: 'bg-[#3D2940] hover:bg-[#2A1B2C] text-white shadow-sm',
    secondaryButtonClass:
      'bg-white hover:bg-[#FFFAF6] text-[#3D2940] border border-[#DFD2DC]',
    heroOverlayClass:
      'bg-gradient-to-r from-white/95 via-white/88 to-transparent',
    announcementClass: 'bg-[#FFFAF6] text-[#3D2940] border-[#EDE4EA]',
    footerClass: 'bg-white border-[#EDE4EA] text-[#3D2940]',
    headingFontClass: 'font-serif-display',
    dividerClass: 'border-[#EDE4EA]',
    isDark: false,
  },
];

export function isProStoreTheme(rawTheme?: string): boolean {
  const normalized = normalizeStoreThemeId(rawTheme);
  const found = STORE_THEMES.find((t) => t.id === normalized);
  return found?.tier === 'pro';
}

export function normalizeStoreThemeId(
  rawTheme?: string
): StoreThemeDefinition['id'] {
  switch (rawTheme) {
    case 'blush-bloom':
    case 'blush-princess':
    case 'blush-rose':
      return 'blush-bloom';
    case 'lavender-cloud':
    case 'lavender-dreams':
      return 'lavender-cloud';
    case 'vanilla-studio':
    case 'vanilla-bloom':
    case 'warm-cream':
      return 'vanilla-studio';
    case 'midnight-muse':
    case 'midnight-fairy':
    case 'rosewood':
      return 'midnight-muse';
    case 'peach-petal':
    case 'rose-garden':
    case 'petal-peach':
      return 'peach-petal';
    case 'clean-canvas':
    case 'minimal-muse':
      return 'clean-canvas';
    default:
      return 'blush-bloom';
  }
}

export function resolveStoreTheme(
  rawTheme?: string,
  customAccentColor?: string
): StoreThemeDefinition {
  const normalizedId = normalizeStoreThemeId(rawTheme);
  const base =
    STORE_THEMES.find((t) => t.id === normalizedId) || STORE_THEMES[0];
  const cleanAccent = (customAccentColor || '').trim();
  if (!cleanAccent) {
    return base;
  }
  const matchingPreset = CUSTOM_ACCENT_PRESETS.find(
    (p) => p.id.toLowerCase() === cleanAccent.toLowerCase()
  );
  if (matchingPreset) {
    return {
      ...base,
      accentTextClass: base.isDark ? base.accentTextClass : matchingPreset.accentTextClass,
      buttonClass: matchingPreset.buttonClass,
    };
  }
  return base;
}

export const INITIAL_ASSETS = {
  heroBanner: '/src/assets/images/fatima_hero_banner_1791519534532.jpg',
  book30DayReset: '/src/assets/images/book_30_day_reset_1791519551780.jpg',
  bookProductivityPlanner: '/src/assets/images/book_productivity_planner_1791519565673.jpg',
  bookSelfCareToolkit: '/src/assets/images/book_self_care_toolkit_1791519580325.jpg',
  avatarFatima: '/src/assets/images/avatar_fatima_1791519592784.jpg',
};

/**
 * Resolves any store logo, avatar, banner, or product image URL.
 * - Maps legacy '/src/assets/images/...' paths (including those persisted in Firestore) to bundled Vite asset URLs.
 * - Preserves legitimate seller-uploaded data URLs and HTTPS URLs untouched.
 * - Returns fallbackUrl only when rawUrl is genuinely missing or an unresolvable raw gs:// path.
 */
export function resolveStoreAssetUrl(
  rawUrl?: string | null,
  fallbackUrl = ''
): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null' || trimmed.startsWith('gs://')) {
    return fallbackUrl;
  }
  if (trimmed.includes('avatar_fatima_1791519592784')) {
    return INITIAL_ASSETS.avatarFatima;
  }
  if (trimmed.includes('book_30_day_reset_1791519551780')) {
    return INITIAL_ASSETS.book30DayReset;
  }
  if (trimmed.includes('book_productivity_planner_1791519565673')) {
    return INITIAL_ASSETS.bookProductivityPlanner;
  }
  if (trimmed.includes('book_self_care_toolkit_1791519580325')) {
    return INITIAL_ASSETS.bookSelfCareToolkit;
  }
  if (trimmed.includes('fatima_hero_banner_1791519534532')) {
    return INITIAL_ASSETS.heroBanner;
  }
  return trimmed;
}

export function createSampleGuideDataUrl(title: string, subtitle: string): string {
  const content = [
    `====================================================`,
    `  DREAMSTORE VERIFIED DIGITAL DOWNLOAD`,
    `  Title: ${title}`,
    `  Subtitle: ${subtitle}`,
    `  Downloaded from: Fatima.tech / DreamStore Platform`,
    `====================================================`,
    ``,
    `Thank you for downloading "${title}"!`,
    ``,
    `Included in this digital guide:`,
    `1. Daily Mindful Habit Tracker & Morning Intention Prompts`,
    `2. Weekly Reflection & Calm Productivity Framework`,
    `3. Printable Action Worksheets`,
    ``,
    `Generated securely via DreamStore Digital Delivery.`,
  ].join('\n');
  return `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`;
}

export const INITIAL_STORE_CONFIG: StoreConfig = {
  storeId: 'store-fatima-tech',
  ownerId: 'seller-pk-fatima',
  storeSlug: 'fatima.tech',

  landingBrand: 'DreamStore',
  landingHeroLine1: 'Your Dream Store',
  landingHeroLine2: 'Starts Here.',
  landingSubheading:
    'Create your free digital store, add your products, and share your link.',
  landingCtaPrimary: 'Create My Free Store',
  landingCtaSecondary: 'Explore Stores',

  storeName: 'Fatima.tech',
  ownerName: 'Fatima',
  ownerRole: 'Store Owner',
  ownerEmail: '',
  ownerAvatar: INITIAL_ASSETS.avatarFatima,
  logoUrl: INITIAL_ASSETS.avatarFatima,
  sellerCountry: 'Pakistan',
  instagramHandle: '@fatima.tech',
  socialWebsite: 'https://dreamstore.ai.studio/s/fatima.tech',
  productType: 'Ebooks & Planners',
  theme: 'blush-rose',
  currency: 'PKR',
  exchangeRatePkr: 278,

  announcementText: 'Welcome to Fatima.tech — Small Steps, Big Changes. 💕',
  heroHeadingLine1: 'Small Steps',
  heroHeadingLine2: 'Big Changes.',
  heroSubheading:
    'Digital products to help you grow, stay consistent, and create the life you love.',
  heroButtonText: 'Shop Now',
  heroImage: INITIAL_ASSETS.heroBanner,

  sections: [
    { id: 'sec-header', name: 'Header', visible: true, type: 'header' },
    { id: 'sec-hero', name: 'Hero Section', visible: true, type: 'hero' },
    { id: 'sec-products', name: 'Featured Products', visible: true, type: 'products' },
    { id: 'sec-categories', name: 'Categories', visible: true, type: 'categories' },
    { id: 'sec-about', name: 'About Section', visible: true, type: 'about' },
    { id: 'sec-newsletter', name: 'Newsletter', visible: true, type: 'newsletter' },
    { id: 'sec-footer', name: 'Footer', visible: true, type: 'footer' },
  ],
};

export const INDIA_STORE_CONFIG: StoreConfig = {
  storeId: 'store-in-ananya',
  ownerId: 'seller-in-ananya',
  storeSlug: 'ananya.creates',

  landingBrand: 'DreamStore',
  landingHeroLine1: 'Your Dream Store',
  landingHeroLine2: 'Starts Here.',
  landingSubheading:
    'Create your free digital store, add your products, and share your link.',
  landingCtaPrimary: 'Create My Free Store',
  landingCtaSecondary: 'Explore Stores',

  storeName: 'Ananya Creates',
  ownerName: 'Ananya Sharma',
  ownerRole: 'Store Owner (India)',
  ownerEmail: '',
  ownerAvatar: INITIAL_ASSETS.avatarFatima,
  logoUrl: INITIAL_ASSETS.avatarFatima,
  sellerCountry: 'India',
  instagramHandle: '@ananya.creates',
  socialWebsite: 'https://dreamstore.ai.studio/?store=ananya.creates',
  productType: 'Templates & Workbooks',
  theme: 'petal-peach',
  currency: 'INR',
  exchangeRatePkr: 278,

  announcementText: 'Welcome to Ananya Creates — Mindful Digital Systems in INR ✨',
  heroHeadingLine1: 'Create Calm,',
  heroHeadingLine2: 'Design Your Flow.',
  heroSubheading:
    'Curated PDF workbooks, journals, and productivity systems for creators and students across India.',
  heroButtonText: 'Explore Collection',
  heroImage: INITIAL_ASSETS.heroBanner,

  sections: [
    { id: 'sec-header', name: 'Header', visible: true, type: 'header' },
    { id: 'sec-hero', name: 'Hero Section', visible: true, type: 'hero' },
    { id: 'sec-products', name: 'Featured Products', visible: true, type: 'products' },
    { id: 'sec-categories', name: 'Categories', visible: true, type: 'categories' },
    { id: 'sec-about', name: 'About Section', visible: true, type: 'about' },
    { id: 'sec-newsletter', name: 'Newsletter', visible: true, type: 'newsletter' },
    { id: 'sec-footer', name: 'Footer', visible: true, type: 'footer' },
  ],
};

export const INITIAL_STORE_CONFIGS: Record<string, StoreConfig> = {
  'store-fatima-tech': INITIAL_STORE_CONFIG,
};

export const INITIAL_PRODUCTS: Product[] = [
  {
    id: 'prod-30-day-reset',
    storeId: 'store-fatima-tech',
    ownerId: 'seller-pk-fatima',
    title: 'The 30-Day Life Reset',
    category: 'Ebooks',
    subtitle: 'A gentle guide to a happier, healthier you.',
    description:
      'The 30-Day Life Reset is a simple and practical guide to help you build healthier habits, improve your mindset, and create a more peaceful and productive life.',
    whatsIncluded: [
      '30 Daily Guided Prompts & Reflection Pages (120-page PDF)',
      'Morning & Evening Gentle Routine Trackers',
      'Mindful Habit Reset Checklists & Weekly Review Templates',
      'Printable & iPad GoodNotes / Notability Hyperlinked Versions',
    ],
    details: [
      { label: 'Format', value: 'Interactive PDF + Printable Bundle' },
      { label: 'Pages', value: '120 Pages' },
      { label: 'Delivery', value: 'Instant Digital Download' },
      { label: 'Language', value: 'English' },
    ],
    price: 29,
    priceUsd: 29,
    pricePkr: 1000, // Matches user's 1,000 PKR commission example!
    isFree: false,
    published: true,
    status: 'Available',
    image: INITIAL_ASSETS.book30DayReset,
    gallery: [
      INITIAL_ASSETS.book30DayReset,
      INITIAL_ASSETS.heroBanner,
      INITIAL_ASSETS.bookProductivityPlanner,
      INITIAL_ASSETS.bookSelfCareToolkit,
    ],
    features: [
      {
        title: 'PDF Format',
        subtitle: 'Instant Download',
        icon: 'pdf',
      },
      {
        title: 'Easy to Follow',
        subtitle: 'Step-by-Step Guide',
        icon: 'guide',
      },
      {
        title: 'Full of Practical Tools',
        subtitle: 'Worksheets & Templates',
        icon: 'tools',
      },
    ],
    fileName: 'The-30-Day-Life-Reset-Guide.txt',
    fileType: 'PDF / Digital Guide',
    fileSizeLabel: '14.2 MB',
    fileDataUrl: createSampleGuideDataUrl(
      'The 30-Day Life Reset',
      'A gentle guide to a happier, healthier you.'
    ),
  },
  {
    id: 'prod-productivity-planner',
    storeId: 'store-fatima-tech',
    ownerId: 'seller-pk-fatima',
    title: 'Productivity Planner',
    category: 'Planners',
    subtitle: 'Plan your days with clarity, calm focus, and intention.',
    description:
      'Designed for mindful creators and students, the Productivity Planner helps you prioritize your top 3 daily goals, time-block without burnout, and celebrate small wins every week.',
    whatsIncluded: [
      'Undated Daily, Weekly & Monthly Planning Spreads',
      'Goal Breakdown & Quarterly Vision Board Pages',
      'Focus Timer & Habit Consistency Tracker',
    ],
    details: [
      { label: 'Format', value: 'Hyperlinked PDF & Notion Template' },
      { label: 'Pages', value: '185 Pages' },
      { label: 'Delivery', value: 'Instant Digital Download' },
      { label: 'Compatibility', value: 'GoodNotes, Notability, Desktop & Print' },
    ],
    price: 34,
    priceUsd: 34,
    pricePkr: 2500,
    isFree: false,
    published: true,
    status: 'Available',
    image: INITIAL_ASSETS.bookProductivityPlanner,
    gallery: [
      INITIAL_ASSETS.bookProductivityPlanner,
      INITIAL_ASSETS.book30DayReset,
      INITIAL_ASSETS.bookSelfCareToolkit,
      INITIAL_ASSETS.heroBanner,
    ],
    features: [
      {
        title: 'PDF Format',
        subtitle: 'Instant Download',
        icon: 'pdf',
      },
      {
        title: 'Easy to Follow',
        subtitle: 'Step-by-Step Guide',
        icon: 'guide',
      },
      {
        title: 'Full of Practical Tools',
        subtitle: 'Worksheets & Templates',
        icon: 'tools',
      },
    ],
    fileName: 'DreamStore-Productivity-Planner-2026.txt',
    fileType: 'PDF Planner',
    fileSizeLabel: '18.6 MB',
    fileDataUrl: createSampleGuideDataUrl(
      'Productivity Planner',
      'Plan your days with clarity, calm focus, and intention.'
    ),
  },
  {
    id: 'prod-self-care-toolkit',
    storeId: 'store-fatima-tech',
    ownerId: 'seller-pk-fatima',
    title: 'Self-Care Toolkit',
    category: 'Workbooks',
    subtitle: 'Simple daily practices for emotional balance and wellbeing.',
    description:
      'Nurture your mind, body, and soul with gentle self-care rituals, gratitude journaling prompts, boundary-setting exercises, and calming evening wind-down worksheets. Available as a free starter download!',
    whatsIncluded: [
      'Self-Care Menu & Energy Audit Worksheets',
      '50+ Deep Journaling Prompts for Emotional Clarity',
      'Weekly Nourishment, Sleep & Mood Trackers',
    ],
    details: [
      { label: 'Format', value: 'Digital Workbook (PDF)' },
      { label: 'Pages', value: '96 Pages' },
      { label: 'Delivery', value: 'Instant Digital Download' },
      { label: 'Language', value: 'English' },
    ],
    price: 0,
    priceUsd: 0,
    pricePkr: 0,
    isFree: true,
    published: true,
    status: 'Available',
    image: INITIAL_ASSETS.bookSelfCareToolkit,
    gallery: [
      INITIAL_ASSETS.bookSelfCareToolkit,
      INITIAL_ASSETS.book30DayReset,
      INITIAL_ASSETS.bookProductivityPlanner,
      INITIAL_ASSETS.heroBanner,
    ],
    features: [
      {
        title: 'PDF Format',
        subtitle: 'Instant Download',
        icon: 'pdf',
      },
      {
        title: 'Easy to Follow',
        subtitle: 'Step-by-Step Guide',
        icon: 'guide',
      },
      {
        title: 'Full of Practical Tools',
        subtitle: 'Worksheets & Templates',
        icon: 'tools',
      },
    ],
    fileName: 'Self-Care-Toolkit-Free-Edition.pdf',
    fileType: 'Digital Workbook (PDF)',
    fileSizeLabel: '9.4 MB',
    fileDataUrl: createSampleGuideDataUrl(
      'Self-Care Toolkit (Free Starter Edition)',
      'Simple daily practices for emotional balance and wellbeing.'
    ),
  },
  {
    id: 'prod-in-mindful-journal',
    storeId: 'store-in-ananya',
    ownerId: 'seller-in-ananya',
    title: 'Mindful Creator Notion & PDF System',
    category: 'Templates',
    subtitle: 'Complete workspace & printable PDF workbook for Indian creators.',
    description:
      'Built by Ananya Sharma in Bengaluru, this all-in-one PDF workbook and planner system helps creators batch content, track brand collaborations, and plan mindful routines.',
    whatsIncluded: [
      '140-Page Hyperlinked Creator Workbook (PDF)',
      'Content Calendar & Sponsorship Tracker Sheets',
      'Weekly Mindful Reflection & Goal Spreads',
    ],
    details: [
      { label: 'Format', value: 'PDF Workbook + Template Bundle' },
      { label: 'Pages', value: '140 Pages' },
      { label: 'Delivery', value: 'Instant Verified Digital Download' },
      { label: 'Language', value: 'English' },
    ],
    price: 15,
    priceUsd: 15,
    pricePkr: 4170,
    isFree: false,
    published: true,
    status: 'Available',
    image: INITIAL_ASSETS.bookProductivityPlanner,
    gallery: [
      INITIAL_ASSETS.bookProductivityPlanner,
      INITIAL_ASSETS.book30DayReset,
      INITIAL_ASSETS.bookSelfCareToolkit,
      INITIAL_ASSETS.heroBanner,
    ],
    features: [
      { title: 'PDF Format', subtitle: 'Instant Download', icon: 'pdf' },
      { title: 'Easy to Follow', subtitle: 'Step-by-Step Guide', icon: 'guide' },
      { title: 'Full of Practical Tools', subtitle: 'Worksheets & Templates', icon: 'tools' },
    ],
    fileName: 'Ananya-Mindful-Creator-System.pdf',
    fileType: 'PDF Workbook',
    fileSizeLabel: '12.8 MB',
    fileDataUrl: createSampleGuideDataUrl(
      'Mindful Creator Notion & PDF System',
      'Complete workspace & printable PDF workbook for Indian creators.'
    ),
  },
  {
    id: 'prod-in-free-habit-sheet',
    storeId: 'store-in-ananya',
    ownerId: 'seller-in-ananya',
    title: 'Daily Calm Habit Tracker (Free PDF)',
    category: 'Workbooks',
    subtitle: 'Free 30-day printable habit & morning gratitude PDF sheet.',
    description:
      'Start your morning with intention using Ananya Creates’ free printable PDF habit tracker and gratitude log.',
    whatsIncluded: [
      '30-Day Printable Habit Grid (A4 & iPad PDF)',
      'Morning Gratitude & Evening Wind-Down Prompts',
    ],
    details: [
      { label: 'Format', value: 'PDF Printable' },
      { label: 'Pages', value: '24 Pages' },
      { label: 'Delivery', value: 'Instant Free Download' },
      { label: 'Language', value: 'English' },
    ],
    price: 0,
    priceUsd: 0,
    pricePkr: 0,
    isFree: true,
    published: true,
    status: 'Available',
    image: INITIAL_ASSETS.bookSelfCareToolkit,
    gallery: [
      INITIAL_ASSETS.bookSelfCareToolkit,
      INITIAL_ASSETS.bookProductivityPlanner,
      INITIAL_ASSETS.heroBanner,
    ],
    features: [
      { title: 'PDF Format', subtitle: 'Instant Download', icon: 'pdf' },
      { title: 'Easy to Follow', subtitle: 'Step-by-Step Guide', icon: 'guide' },
      { title: 'Full of Practical Tools', subtitle: 'Worksheets & Templates', icon: 'tools' },
    ],
    fileName: 'Ananya-Free-Habit-Sheet.pdf',
    fileType: 'PDF Printable',
    fileSizeLabel: '3.6 MB',
    fileDataUrl: createSampleGuideDataUrl(
      'Daily Calm Habit Tracker (Free PDF)',
      'Free 30-day printable habit & morning gratitude PDF sheet.'
    ),
  },
];

export const INITIAL_SELLER_PAYMENT_SETTINGS: SellerPaymentSettings = {
  ownerId: '',
  email: '',
  jazzCashMerchantId: '',
  jazzCashEnabled: false,
  easypaisaStoreId: '',
  easypaisaEnabled: false,
  upiId: '',
  paymentLinkUrl: '',
  payoneerEnabled: false,
  payoneerReceivingEmail: '',
  payoneerRequestLink: '',
  payoneerReceivingAccountDetails: '',
  whatsappNotificationNumber: '',
  whatsappNotificationsEnabled: false,
  stripeAccountId: '',
  stripeEnabled: false,
  bankTransferInstructions: '',
  paymentConfigured: false,
  configuredMethods: [],
};

export const INDIA_SELLER_PAYMENT_SETTINGS: SellerPaymentSettings = {
  ...INITIAL_SELLER_PAYMENT_SETTINGS,
};

export const INITIAL_SELLER_PAYMENT_SETTINGS_BY_STORE: Record<string, SellerPaymentSettings> = {};

// Always load platform stores from verified Firestore/server data.
export const INITIAL_PLATFORM_STORES: PlatformStore[] = [];

export function convertPriceToCurrency(
  product: Pick<Product, 'isFree' | 'priceUsd' | 'pricePkr'>,
  currency: CurrencyCode,
  exchangeRatePkr = 278
): number {
  if (product.isFree || (product.priceUsd === 0 && product.pricePkr === 0)) {
    return 0;
  }
  if (currency === 'PKR') {
    return product.pricePkr > 0 ? product.pricePkr : Math.round(product.priceUsd * exchangeRatePkr);
  }
  if (currency === 'USD') {
    return product.priceUsd;
  }
  const meta = CURRENCY_META[currency] || CURRENCY_META.USD;
  return Math.round(product.priceUsd * meta.rateFromUsd * 100) / 100;
}

export function formatCurrency(
  product: Pick<Product, 'isFree' | 'priceUsd' | 'pricePkr'>,
  currency: CurrencyCode,
  exchangeRatePkr = 278
): string {
  const val = convertPriceToCurrency(product, currency, exchangeRatePkr);
  if (val === 0) return 'Free';
  const meta = CURRENCY_META[currency] || CURRENCY_META.USD;
  if (currency === 'PKR' || currency === 'INR') {
    return `${meta.symbol}${Math.round(val).toLocaleString()}`;
  }
  return `${meta.symbol}${val.toFixed(2)}`;
}

export function calculateCommissionMinor(
  grossMajor: number,
  currency: CurrencyCode,
  commissionRateBps = 500,
  paymentMethod: PaymentMethodId = 'jazzcash'
): CommissionBreakdown {
  const grossAmountMinor = Math.round(grossMajor * 100);
  if (grossAmountMinor <= 0) {
    return {
      currency,
      commissionRateBps,
      grossAmountMinor: 0,
      platformCommissionMinor: 0,
      gatewayFeeMinor: 0,
      sellerShareBeforeFeesMinor: 0,
      sellerNetEarningsMinor: 0,
    };
  }
  // Exact integer minor-unit math:
  // Example: 1,000 PKR (100,000 paisa) * 500 bps / 10,000 = 5,000 paisa (50 PKR)
  const platformCommissionMinor = Math.round((grossAmountMinor * commissionRateBps) / 10000);
  const sellerShareBeforeFeesMinor = grossAmountMinor - platformCommissionMinor; // 95,000 paisa (950 PKR)

  // Manual direct transfers (JazzCash, Easypaisa, UPI, Payoneer Manual, Bank Transfer) have 0 gateway fee charged by DreamStore
  const isManualMethod =
    paymentMethod === 'manual_bank' ||
    paymentMethod === 'free_instant' ||
    paymentMethod === 'upi_india' ||
    paymentMethod === 'payoneer' ||
    paymentMethod === 'jazzcash' ||
    paymentMethod === 'easypaisa';

  const gatewayFeeBps = isManualMethod
    ? 0
    : paymentMethod === 'stripe_card'
    ? 290
    : 200;
  const gatewayFeeMinor = Math.round((grossAmountMinor * gatewayFeeBps) / 10000);
  const sellerNetEarningsMinor = Math.max(0, sellerShareBeforeFeesMinor - gatewayFeeMinor);

  return {
    currency,
    commissionRateBps,
    grossAmountMinor,
    platformCommissionMinor,
    gatewayFeeMinor,
    sellerShareBeforeFeesMinor,
    sellerNetEarningsMinor,
  };
}

export function formatMinorToMajor(minor: number, currency: CurrencyCode): string {
  const meta = CURRENCY_META[currency] || CURRENCY_META.USD;
  const major = minor / 100;
  if (currency === 'PKR' || currency === 'INR') {
    return `${meta.symbol}${Math.round(major).toLocaleString()}`;
  }
  return `${meta.symbol}${major.toFixed(2)}`;
}

export const PUBLIC_STORE_DOMAIN: string =
  (typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_PUBLIC_STORE_DOMAIN) ||
  'https://dreamstore.app';

export function buildPublicStoreUrl(storeSlug?: string): string {
  const cleanSlug = (storeSlug || 'your-store').trim().toLowerCase();
  const baseDomain = PUBLIC_STORE_DOMAIN.replace(/\/+$/, '');
  return `${baseDomain}/?store=${encodeURIComponent(cleanSlug)}`;
}

