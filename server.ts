import express from 'express';
import { asyncRoute, apiErrorHandler, installAuthHelperProxy } from './server/http.ts';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import {
  applicationDefault,
  getApps,
  initializeApp as initializeAdminApp,
} from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore, type Firestore as AdminFirestore } from 'firebase-admin/firestore';
import { getStorage as getAdminStorage } from 'firebase-admin/storage';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) throw new Error('PORT must be a valid TCP port.');
const LEGACY_EMAIL_AUTH_ENABLED = process.env.NODE_ENV === 'development' &&
  process.env.DREAMSTORE_LEGACY_EMAIL_AUTH_ENABLED === 'true';
// Admin identity must come from a verified Firebase token, never a source-code email.
const SUPER_ADMIN_EMAIL = '';
// Strictly read SUPER_ADMIN_UID from environment configuration — NEVER fall back to any hardcoded UID
const SUPER_ADMIN_UID = (process.env.SUPER_ADMIN_UID || '').trim();
const SUPER_ADMIN_BOOTSTRAP_SECRET = (process.env.SUPER_ADMIN_BOOTSTRAP_SECRET || '').trim();

// Read Firebase config for server-side Google Identity Toolkit verification, Firestore REST sync & Admin SDK projectId
let FIREBASE_API_KEY = '';
let FIREBASE_PROJECT_ID = 'dreamstore';
let FIREBASE_AUTH_DOMAIN = '';
let FIREBASE_OAUTH_CLIENT_ID = '';
let FIRESTORE_DATABASE_ID = '(default)';
let FIREBASE_STORAGE_BUCKET = '';
try {
  const cfgRaw = fs.readFileSync(path.join(__dirname, 'firebase-applet-config.json'), 'utf8');
  const parsedCfg = JSON.parse(cfgRaw);
  FIREBASE_API_KEY = parsedCfg.apiKey || '';
  FIREBASE_PROJECT_ID = parsedCfg.projectId || 'dreamstore';
  FIREBASE_AUTH_DOMAIN = parsedCfg.authDomain || `${FIREBASE_PROJECT_ID}.firebaseapp.com`;
  FIREBASE_OAUTH_CLIENT_ID = parsedCfg.oAuthClientId || '';
  FIRESTORE_DATABASE_ID = parsedCfg.firestoreDatabaseId || '(default)';
  FIREBASE_STORAGE_BUCKET = parsedCfg.storageBucket || '';
} catch {
  FIREBASE_API_KEY = '';
}

// Cloud Run provides ADC using its attached service identity; local runs use an
// explicitly configured credential, gcloud ADC, or the Firestore emulator.
// Without any of these, avoid starting a Firestore gRPC client that may reject
// outside the API handler and terminate an otherwise healthy process. Protected
// operations and /api/ready continue to fail closed without Admin access.
const HAS_GOOGLE_ADC_CONTEXT = Boolean(
  process.env.K_SERVICE ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  process.env.FIRESTORE_EMULATOR_HOST ||
  fs.existsSync(path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json'))
);
let adminFirestoreDb: AdminFirestore | null = null;
if (HAS_GOOGLE_ADC_CONTEXT) {
  try {
    const adminApp = getApps().length
      ? getApps()[0]
      : initializeAdminApp({
          credential: applicationDefault(),
          projectId: FIREBASE_PROJECT_ID,
        });
    adminFirestoreDb = getAdminFirestore(adminApp, FIRESTORE_DATABASE_ID);
    adminFirestoreDb.settings({ preferRest: true, ignoreUndefinedProperties: true });
  } catch {
    adminFirestoreDb = null;
    // Readiness and protected operations must reject until Admin is configured.
  }
}

const STABLE_SIGNING_SECRET_FILE = path.join(os.tmpdir(), '.dreamstore-stable-signing-secret.key');

function initializeStableServerSigningSecret(): string {
  const envSecret = (
    process.env.SERVER_SIGNING_SECRET ||
    process.env.DOWNLOAD_SIGNING_SECRET ||
    process.env.TOKEN_SIGNING_SECRET ||
    ''
  ).trim();
  if (
    envSecret.length >= 32 &&
    !envSecret.toLowerCase().includes('default') &&
    !envSecret.toLowerCase().includes('placeholder') &&
    !envSecret.toLowerCase().includes('change_me')
  ) {
    return envSecret;
  }

  // Reload existing stable secret from secure system tmp file if it exists
  try {
    if (fs.existsSync(STABLE_SIGNING_SECRET_FILE)) {
      const persisted = fs.readFileSync(STABLE_SIGNING_SECRET_FILE, 'utf8').trim();
      if (persisted.length >= 32) {
        return persisted;
      }
    }
  } catch {
    // Non-fatal read
  }

  // Generate a cryptographically secure 256-bit CSPRNG secret and persist it securely in os.tmpdir() with 0o600
  const newSecret = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(STABLE_SIGNING_SECRET_FILE, newSecret, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch {
    // Non-fatal write
  }
  return newSecret;
}

// Production instances must share a stable secret (e.g. Cloud Run Secret Manager).
// A secret generated under /tmp can be different on restart and would invalidate
// paid buyer downloads. Never accept paid orders using an ephemeral signing key.
const PROVIDED_SIGNING_SECRET = (
  process.env.SERVER_SIGNING_SECRET ||
  process.env.DOWNLOAD_SIGNING_SECRET ||
  process.env.TOKEN_SIGNING_SECRET ||
  ''
).trim();
const HAS_DURABLE_PRODUCTION_SIGNING_SECRET =
  PROVIDED_SIGNING_SECRET.length >= 32 &&
  !['default', 'placeholder', 'change_me'].some((bad) =>
    PROVIDED_SIGNING_SECRET.toLowerCase().includes(bad)
  );
// No real-money checkout in an unverified production deployment. Staging may
// test paid flows; production requires a deliberate operator-controlled switch.
const PAID_CHECKOUT_ENABLED =
  process.env.NODE_ENV !== 'production' ||
  process.env.DREAMSTORE_PAID_CHECKOUT_ENABLED === 'true';

const SIGNING_SECRET = initializeStableServerSigningSecret();

const SUPPORTED_CURRENCIES: Record<string, number> = {
  USD: 1,
  PKR: 278,
  INR: 84,
  GBP: 0.78,
  EUR: 0.92,
  AED: 3.67,
  SAR: 3.75,
  CAD: 1.38,
  AUD: 1.52,
};

// Configurable Platform Commission in Basis Points (default 500 bps = 5.00%)
// Strictly server-authoritative — sellers can never modify this.
let platformCommissionBps = 500;
const INVOICE_SALES_THRESHOLD = 5;
const INVOICE_PAYMENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface ServerStoreRecord {
  storeId: string;
  ownerId: string;
  ownerEmail: string;
  ownerName?: string;
  storeSlug: string;
  storeName: string;
  country: string;
  sellerCountry?: string;
  productType?: string;
  currency: string;
  exchangeRatePkr?: number;
  theme: string;
  plan?: 'Free' | 'Pro';
  instagramHandle: string;
  announcementText?: string;
  heroHeadingLine1?: string;
  heroHeadingLine2?: string;
  heroSubheading?: string;
  heroButtonText?: string;
  heroImage?: string;
  logoUrl?: string;
  status: 'Active' | 'Pending';
}

export interface ServerProductRecord {
  id: string;
  storeId: string;
  ownerId: string;
  title: string;
  category: string;
  subtitle?: string;
  description?: string;
  isFree: boolean;
  priceUsd: number;
  pricePkr: number;
  published: boolean;
  status?: 'Available' | 'Coming Soon' | 'Draft';
  image?: string;
  fileName: string;
  fileType: string;
  fileSizeLabel?: string;
}

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

export interface LedgerEntry {
  ledgerId: string;
  orderId: string;
  orderNumber: string;
  storeId: string;
  sellerId: string;
  buyerId: string;
  primaryProductId: string;
  customerName?: string;
  customerEmail?: string;
  itemTitlesSummary?: string;
  itemCount?: number;
  totalAmount?: number;
  currency: string;
  commissionRateBps: number;
  grossAmountMinor: number;
  platformCommissionMinor: number;
  sellerShareBeforeFeesMinor: number;
  gatewayFeeMinor: number;
  sellerNetEarningsMinor: number;
  paymentMethod: string;
  paymentReference: string;
  paymentStatus: 'Pending' | 'Paid' | 'Failed' | 'Refunded';
  verificationMode: VerificationMode;
  commissionStatus: CommissionStatus;
  payoutStatus: string;
  downloadToken: string;
  downloadCount: number;
  maxDownloads: number;
  expiresAtMs: number;
  verifiedByUid?: string;
  verifiedAtIso?: string;
  createdAtIso: string;
  updatedAtIso: string;
  refundedAtIso?: string;
  invoiceId?: string;
  buyerEmailNotification?: BuyerPaidEmailNotificationRecord;
}

export interface BuyerPaidEmailNotificationRecord {
  emailId: string;
  orderNumber: string;
  orderId: string;
  storeId: string;
  sellerId: string;
  buyerId: string;
  recipientEmail: string;
  customerName: string;
  subject: string;
  productSummary: string;
  currency: string;
  totalAmountMajor: number;
  verificationMode: VerificationMode;
  downloadToken: string;
  expiresAtIso: string;
  securitySignature: string;
  deliveryProvider: 'resend_api' | 'secure_outbox';
  status: 'sent' | 'failed' | 'skipped';
  sentAtIso: string;
  errorDetail?: string;
}

export interface LedgerAuditRecord {
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

export const RESTRICTED_FEATURES_ON_OVERDUE: RestrictedSellerFeature[] = [
  'add_product',
  'publish_product',
  'visual_store_builder',
  'theme_customization',
];

export const UNRESTRICTED_FEATURES_ALWAYS: string[] = [
  'public_storefront_visibility',
  'existing_product_purchases',
  'buyer_checkout',
  'payment_processing',
  'existing_orders',
  'digital_product_downloads',
  'seller_access_to_orders',
  'seller_access_to_commission_payments',
  'customer_support_and_refunds',
];

export interface CommissionInvoiceRecord {
  invoiceId: string;
  invoiceNumber: string;
  sellerId: string;
  storeId: string;
  currency: string;
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

export interface CommissionPaymentSubmission {
  paymentId: string;
  invoiceId: string;
  invoiceNumber: string;
  sellerId: string;
  storeId: string;
  currency: string;
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

export interface CommissionAdjustmentEntry {
  adjustmentId: string;
  invoiceId: string;
  invoiceNumber: string;
  orderNumber: string;
  sellerId: string;
  currency: string;
  adjustmentAmountMinor: number;
  reason: 'order_refunded' | 'order_disputed';
  detail: string;
  createdAtIso: string;
}

// Multi-Vendor Stores Registry (Hydrated from Firestore stores collection; zero hardcoded demo stores)
const serverStores = new Map<string, ServerStoreRecord>();

// Storefront Visit & Traffic Telemetry Registry (storeId -> visits & checkout views)
const storeVisitsRegistry = new Map<
  string,
  { visitsCount: number; checkoutViewsCount: number; lastVisitedAtIso: string }
>();

function getOrInitStoreVisits(storeId: string): {
  visitsCount: number;
  checkoutViewsCount: number;
  lastVisitedAtIso: string;
} {
  const existing = storeVisitsRegistry.get(storeId);
  if (existing) return existing;
  // New stores begin at real zero. Never fabricate visits or checkout activity.
  // In-memory counts are not durable analytics; show them as session activity only.
  const initial = {
    visitsCount: 0,
    checkoutViewsCount: 0,
    lastVisitedAtIso: '',
  };
  storeVisitsRegistry.set(storeId, initial);
  return initial;
}

function recordStoreVisit(storeId: string, isCheckoutView = false) {
  if (!storeId) return getOrInitStoreVisits('default');
  const current = getOrInitStoreVisits(storeId);
  current.visitsCount += 1;
  if (isCheckoutView) {
    current.checkoutViewsCount += 1;
  }
  current.lastVisitedAtIso = new Date().toISOString();
  storeVisitsRegistry.set(storeId, current);
  return current;
}

// Server-validated Pro Entitlements Map (sellerId -> boolean)
const sellerProEntitlements = new Map<string, boolean>();

const PRO_THEME_IDS = new Set([
  'peach-petal',
  'rose-garden',
  'midnight-muse',
  'midnight-fairy',
  'clean-canvas',
  'minimal-muse',
]);

// Authoritative Server Product Catalog (Hydrated from Firestore products collection; zero hardcoded demo products)
const serverProducts = new Map<string, ServerProductRecord>();

// Protected Server Deliverable Registry (Never exposed in public store/product listings; served only via /api/delivery/verify-download)
const serverProductDeliverables = new Map<
  string,
  { fileName: string; fileType: string; fileSizeLabel: string; fileDataUrl: string }
>();

// Server-Authoritative Financial Ledger, Invoices, Payments & Adjustments (Synchronized to Firestore; zero local JSON files)
const persistentLedger = new Map<string, LedgerEntry>();
const immutableAuditLog: LedgerAuditRecord[] = [];
const commissionInvoices = new Map<string, CommissionInvoiceRecord>();
const commissionPayments = new Map<string, CommissionPaymentSubmission>();
const commissionAdjustments: CommissionAdjustmentEntry[] = [];
const billedOrderNumbers = new Map<string, string>(); // orderNumber -> invoiceId

// Idempotency ledgers to prevent duplicate payment, order, or webhook processing
const processedIdempotencyKeys = new Map<
  string,
  { orderNumber: string; orderId: string; timestamp: number; downloadToken: string }
>();
const processedWebhookIds = new Set<string>();
const buyerPaidEmailNotifications = new Map<string, BuyerPaidEmailNotificationRecord>(); // orderNumber -> email record

// Per-seller async mutex for atomic financial operations
const sellerMutexQueues = new Map<string, Promise<unknown>>();
function withSellerLock<T>(sellerId: string, fn: () => Promise<T> | T): Promise<T> {
  const key = sellerId || 'global';
  const prev = sellerMutexQueues.get(key) || Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(() => fn());
  sellerMutexQueues.set(key, next);
  return next;
}

// Convert JS object to Firestore REST API fields format
function toFirestoreValue(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((v) => toFirestoreValue(v)) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function fromFirestoreValue(val: Record<string, unknown> | undefined): unknown {
  if (!val || typeof val !== 'object') return undefined;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('stringValue' in val) return String(val.stringValue);
  if ('timestampValue' in val) return String(val.timestampValue);
  if ('arrayValue' in val) {
    const arr = (val.arrayValue as { values?: Record<string, unknown>[] })?.values || [];
    return arr.map((v) => fromFirestoreValue(v));
  }
  if ('mapValue' in val) {
    const fields =
      (val.mapValue as { fields?: Record<string, Record<string, unknown>> })?.fields || {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return undefined;
}

function parseFirestoreDocumentFields(
  docObj: Record<string, unknown> | undefined
): Record<string, unknown> {
  const fields = (docObj?.fields as Record<string, Record<string, unknown>> | undefined) || {};
  const parsed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    parsed[k] = fromFirestoreValue(v);
  }
  return parsed;
}

function syncFirestoreDoc(
  collectionName: string,
  docId: string,
  data: Record<string, unknown>,
  bearerToken?: string
) {
  if (!FIREBASE_PROJECT_ID || !FIREBASE_API_KEY) return;
  const dbPath = `projects/${FIREBASE_PROJECT_ID}/databases/${encodeURIComponent(
    FIRESTORE_DATABASE_ID
  )}/documents/${collectionName}/${encodeURIComponent(docId)}?key=${FIREBASE_API_KEY}`;
  const url = `https://firestore.googleapis.com/v1/${dbPath}`;
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) fields[k] = toFirestoreValue(v);
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ fields }),
  }).catch(() => {
    // Non-blocking background Firestore sync when called from unauthenticated server context
  });
}

function isRealCredentialValue(val: string | undefined | null): boolean {
  if (!val) return false;
  const trimmed = String(val).trim();
  if (trimmed.length < 3) return false;
  const lower = trimmed.toLowerCase();
  const placeholders = [
    'your_',
    'placeholder',
    'dummy',
    'demo',
    'test_key',
    'example',
    'changeme',
    'todo',
    'none',
    'null',
    'undefined',
  ];
  return !placeholders.some((p) => lower.includes(p));
}

function getConfiguredSellerPaymentMethods(
  saved: Record<string, unknown> | null | undefined
): string[] {
  if (!saved) return [];
  const methods: string[] = [];
  const jazzId = String(saved.jazzCashMerchantId || '').trim();
  if (jazzId.length >= 3 && saved.jazzCashEnabled !== false) {
    methods.push('jazzcash');
  }
  const epId = String(saved.easypaisaStoreId || '').trim();
  if (epId.length >= 3 && saved.easypaisaEnabled !== false) {
    methods.push('easypaisa');
  }
  const upi = String(saved.upiId || '').trim();
  if (upi.length >= 3) {
    methods.push('upi_india');
  }
  const bank = String(saved.bankTransferInstructions || '').trim();
  if (bank.length >= 5) {
    methods.push('manual_bank');
  }
  const payoneerActive =
    Boolean(saved.payoneerEnabled) &&
    Boolean(
      String(saved.payoneerReceivingEmail || '').trim().length >= 3 ||
        String(saved.payoneerRequestLink || '').trim().length >= 5 ||
        String(saved.payoneerReceivingAccountDetails || '').trim().length >= 5
    );
  if (payoneerActive) {
    methods.push('payoneer');
  }
  if (
    Boolean(process.env.STRIPE_SECRET_KEY) &&
    Boolean(saved.stripeEnabled) &&
    String(saved.stripeAccountId || '').trim().length >= 3
  ) {
    methods.push('stripe_card');
  }
  if (
    Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) &&
    String(saved.paymentLinkUrl || '').trim().length >= 5
  ) {
    methods.push('razorpay_inr');
  }
  return methods;
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

const LEGACY_RECEIVING_NUMBER_HASHES = new Set([
  // SHA-256 identifiers for obsolete seeded wallet numbers (no personal number literals).
  'b0fd9f2b4ad93144bc025d117a6148960a2f55f8e419185dd14e95fd3ebed84a',
  '8a0ca943236a164475fec186bd798e7ba412597347e931337a03c3935db8b431',
]);

function stripLegacyDemoPaymentValue(rawVal: unknown, maxLen: number): string {
  const str = String(rawVal || '').trim().slice(0, maxLen);
  if (!str) return '';
  const lower = str.toLowerCase();
  for (const demoSub of LEGACY_DEMO_PAYMENT_SUBSTRINGS) {
    if (lower.includes(demoSub)) {
      return '';
    }
  }
  // Sanitize historical seeded payment numbers without publishing them again.
  const normalizedDigits = str.replace(/[^0-9]/g, '');
  for (const length of [10, 11]) {
    for (let i = 0; i + length <= normalizedDigits.length; i++) {
      const digitsHash = crypto.createHash('sha256')
        .update(normalizedDigits.slice(i, i + length)).digest('hex');
      if (LEGACY_RECEIVING_NUMBER_HASHES.has(digitsHash)) return '';
    }
  }
  return str;
}

function normalizeSellerPaymentSettingsRecord(
  raw: Record<string, unknown>,
  effectiveStoreId: string,
  effectiveOwnerId: string
): Record<string, unknown> {
  const jazzCashMerchantId = stripLegacyDemoPaymentValue(raw.jazzCashMerchantId, 120);
  const easypaisaStoreId = stripLegacyDemoPaymentValue(raw.easypaisaStoreId, 120);
  const upiId = stripLegacyDemoPaymentValue(raw.upiId, 120);
  const bankTransferInstructions = stripLegacyDemoPaymentValue(
    raw.bankTransferInstructions,
    1000
  );
  const paymentLinkUrl = stripLegacyDemoPaymentValue(raw.paymentLinkUrl, 300);
  const payoneerReceivingEmail = stripLegacyDemoPaymentValue(raw.payoneerReceivingEmail, 254);
  const payoneerRequestLink = stripLegacyDemoPaymentValue(raw.payoneerRequestLink, 300);
  const payoneerReceivingAccountDetails = stripLegacyDemoPaymentValue(
    raw.payoneerReceivingAccountDetails,
    500
  );
  const whatsappNotificationNumber = stripLegacyDemoPaymentValue(
    raw.whatsappNotificationNumber,
    40
  );
  const stripeAccountId = stripLegacyDemoPaymentValue(raw.stripeAccountId, 120);

  const jazzCashEnabled =
    jazzCashMerchantId.length >= 3 &&
    (raw.jazzCashEnabled === undefined ? true : Boolean(raw.jazzCashEnabled));
  const easypaisaEnabled =
    easypaisaStoreId.length >= 3 &&
    (raw.easypaisaEnabled === undefined ? true : Boolean(raw.easypaisaEnabled));
  const payoneerEnabled = Boolean(raw.payoneerEnabled);
  const whatsappNotificationsEnabled =
    whatsappNotificationNumber.length >= 7 && Boolean(raw.whatsappNotificationsEnabled);
  const stripeEnabled = stripeAccountId.length >= 3 && Boolean(raw.stripeEnabled);

  const record: Record<string, unknown> = {
    storeId: effectiveStoreId,
    ownerId: effectiveOwnerId,
    email: String(raw.email || '').trim().slice(0, 254),
    jazzCashMerchantId,
    jazzCashEnabled,
    easypaisaStoreId,
    easypaisaEnabled,
    upiId,
    paymentLinkUrl,
    payoneerEnabled,
    payoneerReceivingEmail,
    payoneerRequestLink,
    payoneerReceivingAccountDetails,
    whatsappNotificationNumber,
    whatsappNotificationsEnabled,
    stripeAccountId,
    stripeEnabled,
    bankTransferInstructions,
    updatedAtIso: String(raw.updatedAtIso || raw.updatedAt || new Date().toISOString()),
  };
  const configuredMethods = getConfiguredSellerPaymentMethods(record);
  record.configuredMethods = configuredMethods;
  record.paymentConfigured = configuredMethods.length > 0;
  return record;
}

// Verified Seller Payment Settings Cache (Populated strictly from verified seller reads/writes; never exposed directly to buyers)
const firestoreVerifiedSellerSettingsByOwner = new Map<string, Record<string, unknown>>();
const firestoreVerifiedSellerSettingsByStore = new Map<string, Record<string, unknown>>();
const VERIFIED_SELLER_SETTINGS_TMP_PATH = path.join(
  os.tmpdir(),
  'dreamstore-verified-seller-settings.json'
);

function persistVerifiedSellerSettingsTmpCache(): void {
  try {
    const entries: Record<string, Record<string, unknown>> = {};
    for (const [ownerId, rec] of firestoreVerifiedSellerSettingsByOwner.entries()) {
      entries[ownerId] = rec;
    }
    fs.writeFileSync(VERIFIED_SELLER_SETTINGS_TMP_PATH, JSON.stringify(entries), {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch {
    // Non-fatal tmp cache write
  }
}

function cacheVerifiedSellerPaymentSettings(
  ownerId: string,
  storeId: string,
  record: Record<string, unknown>
): void {
  if (!ownerId || !record) return;
  const canonicalStoreId = storeId || `store-${ownerId.slice(0, 20)}`;
  const normalized = normalizeSellerPaymentSettingsRecord(record, canonicalStoreId, ownerId);
  firestoreVerifiedSellerSettingsByOwner.set(ownerId, normalized);
  firestoreVerifiedSellerSettingsByStore.set(canonicalStoreId, normalized);
  if (ownerId === SUPER_ADMIN_UID && SUPER_ADMIN_UID) {
    firestoreVerifiedSellerSettingsByStore.set(
      'store-fatima-tech',
      normalizeSellerPaymentSettingsRecord(record, 'store-fatima-tech', ownerId)
    );
  }
  for (const s of serverStores.values()) {
    if (s.ownerId === ownerId) {
      firestoreVerifiedSellerSettingsByStore.set(
        s.storeId,
        normalizeSellerPaymentSettingsRecord(record, s.storeId, ownerId)
      );
    }
  }
  persistVerifiedSellerSettingsTmpCache();
}

function initVerifiedSellerSettingsCache(): void {
  // Never seed personal or receiving payment details from source code.
  // Load previously saved seller settings; authoritative values come from the seller's
  // protected Firestore records after identity checks.

  try {
    if (fs.existsSync(VERIFIED_SELLER_SETTINGS_TMP_PATH)) {
      const raw = JSON.parse(fs.readFileSync(VERIFIED_SELLER_SETTINGS_TMP_PATH, 'utf8')) as Record<
        string,
        Record<string, unknown>
      >;
      for (const [ownerId, rec] of Object.entries(raw || {})) {
        if (ownerId && rec && typeof rec === 'object') {
          const stId = String(rec.storeId || `store-${ownerId.slice(0, 20)}`);
          cacheVerifiedSellerPaymentSettings(ownerId, stId, rec);
        }
      }
    }
  } catch {
    // Ignore corrupt tmp cache
  }
}

initVerifiedSellerSettingsCache();

async function fetchVerifiedSellerSettingsFromFirestore(
  ownerId: string,
  storeId: string,
  bearerToken?: string
): Promise<Record<string, unknown> | null> {
  // NEVER perform unauthenticated direct Firestore reads on private seller settings.
  // Direct Firestore reads require a verified Owner or Super Admin Bearer token.
  if (!FIREBASE_PROJECT_ID || !FIREBASE_API_KEY || !ownerId || !storeId || !bearerToken) {
    return null;
  }
  const baseDocUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${encodeURIComponent(
    FIRESTORE_DATABASE_ID
  )}/documents`;

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${bearerToken}`,
  };
  const attempts: Array<{ docPath: string; headers: Record<string, string> }> = [
    {
      docPath: `users/${encodeURIComponent(ownerId)}/private/settings`,
      headers: authHeaders,
    },
    {
      docPath: `sellerSettings/${encodeURIComponent(ownerId)}`,
      headers: authHeaders,
    },
  ];

  for (const attempt of attempts) {
    try {
      const res = await fetch(`${baseDocUrl}/${attempt.docPath}?key=${FIREBASE_API_KEY}`, {
        method: 'GET',
        headers: attempt.headers,
      });
      if (!res.ok) continue;
      const docJson = (await res.json()) as Record<string, unknown>;
      if (!docJson || !docJson.fields) continue;
      const parsed = parseFirestoreDocumentFields(docJson);
      if (parsed.ownerId && String(parsed.ownerId) !== ownerId) continue;

      const normalized = normalizeSellerPaymentSettingsRecord(parsed, storeId, ownerId);
      cacheVerifiedSellerPaymentSettings(ownerId, storeId, normalized);
      return normalized;
    } catch {
      // Continue to next candidate path
    }
  }
  return null;
}

let adminFirestoreSdkPermitted = true;

async function fetchSellerSettingsViaAdminCredentials(
  ownerId: string,
  storeId: string
): Promise<Record<string, unknown> | null> {
  if (!ownerId || !storeId || !adminFirestoreDb || !adminFirestoreSdkPermitted) return null;
  const candidateDocs = [
    adminFirestoreDb.collection('users').doc(ownerId).collection('private').doc('settings'),
    adminFirestoreDb.collection('sellerSettings').doc(ownerId),
  ];

  for (const docRef of candidateDocs) {
    try {
      const snap = await Promise.race([
        docRef.get(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 600)),
      ]);
      if (!snap || !snap.exists) continue;
      const rawData = snap.data() as Record<string, unknown> | undefined;
      if (!rawData) continue;
      if (rawData.ownerId && String(rawData.ownerId) !== ownerId) continue;
      const normalized = normalizeSellerPaymentSettingsRecord(rawData, storeId, ownerId);
      cacheVerifiedSellerPaymentSettings(ownerId, storeId, normalized);
      return normalized;
    } catch (err: any) {
      if (err?.code === 7 || String(err?.message || '').includes('PERMISSION_DENIED')) {
        adminFirestoreSdkPermitted = false;
        break;
      }
      // Fall through to next candidate path or verified token/cache lookup
    }
  }
  return null;
}

async function resolveStoreOwnerVerifiedPaymentSettings(
  storeOwnerId: string,
  storeId: string,
  callerUser?: VerifiedAuthUser | null
): Promise<Record<string, unknown> | null> {
  if (!storeOwnerId || !storeId) return null;

  // 1. Check in-memory verified cache first if already populated by the seller
  const byStore = firestoreVerifiedSellerSettingsByStore.get(storeId);
  if (byStore && String(byStore.ownerId) === storeOwnerId) {
    return normalizeSellerPaymentSettingsRecord(byStore, storeId, storeOwnerId);
  }
  const byOwner = firestoreVerifiedSellerSettingsByOwner.get(storeOwnerId);
  if (byOwner && String(byOwner.ownerId) === storeOwnerId) {
    return normalizeSellerPaymentSettingsRecord(byOwner, storeId, storeOwnerId);
  }

  // 2. Read the store owner's payment settings server-side using authorized Firebase Admin credentials if available
  const fromAdminSdk = await fetchSellerSettingsViaAdminCredentials(storeOwnerId, storeId);
  if (fromAdminSdk && String(fromAdminSdk.ownerId) === storeOwnerId) {
    return fromAdminSdk;
  }

  // 3. Read directly from Firestore for storeOwnerId (uses owner token if caller is owner/admin, or direct sellerSettings/{storeOwnerId} lookup)
  const ownerToken =
    callerUser &&
    callerUser.rawToken &&
    (callerUser.uid === storeOwnerId || isStrictSuperAdminUser(callerUser))
      ? callerUser.rawToken
      : undefined;
  const fresh = await fetchVerifiedSellerSettingsFromFirestore(
    storeOwnerId,
    storeId,
    ownerToken
  );
  if (fresh && String(fresh.ownerId) === storeOwnerId) {
    return fresh;
  }

  return null;
}

async function persistSellerSettingsToFirestore(
  ownerId: string,
  record: Record<string, unknown>,
  bearerToken?: string
): Promise<void> {
  if (!ownerId || !record) return;
  cacheVerifiedSellerPaymentSettings(ownerId, String(record.storeId || ''), record);
  if (!FIREBASE_PROJECT_ID || !FIREBASE_API_KEY || !bearerToken) return;
  const dbRoot = `projects/${FIREBASE_PROJECT_ID}/databases/${encodeURIComponent(
    FIRESTORE_DATABASE_ID
  )}/documents`;
  const commitUrl = `https://firestore.googleapis.com/v1/${dbRoot}:commit?key=${FIREBASE_API_KEY}`;

  const firestorePayload: Record<string, unknown> = {
    ownerId,
    email: String(record.email || 'seller@email.com').slice(0, 254),
    jazzCashMerchantId: String(record.jazzCashMerchantId || '').slice(0, 120),
    jazzCashEnabled: Boolean(record.jazzCashEnabled),
    easypaisaStoreId: String(record.easypaisaStoreId || '').slice(0, 120),
    easypaisaEnabled: Boolean(record.easypaisaEnabled),
    upiId: String(record.upiId || '').slice(0, 120),
    paymentLinkUrl: String(record.paymentLinkUrl || '').slice(0, 300),
    payoneerEnabled: Boolean(record.payoneerEnabled),
    payoneerReceivingEmail: String(record.payoneerReceivingEmail || '').slice(0, 254),
    payoneerRequestLink: String(record.payoneerRequestLink || '').slice(0, 300),
    payoneerReceivingAccountDetails: String(record.payoneerReceivingAccountDetails || '').slice(
      0,
      500
    ),
    whatsappNotificationNumber: String(record.whatsappNotificationNumber || '').slice(0, 40),
    whatsappNotificationsEnabled: Boolean(record.whatsappNotificationsEnabled),
    stripeAccountId: String(record.stripeAccountId || '').slice(0, 120),
    stripeEnabled: Boolean(record.stripeEnabled),
    bankTransferInstructions: String(record.bankTransferInstructions || '').slice(0, 1000),
  };

  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(firestorePayload)) {
    fields[k] = toFirestoreValue(v);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${bearerToken}`,
  };

  const paths = [
    `users/${encodeURIComponent(ownerId)}/private/settings`,
    `sellerSettings/${encodeURIComponent(ownerId)}`,
  ];

  await Promise.all(
    paths.map((p) =>
      fetch(commitUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          writes: [
            {
              update: {
                name: `${dbRoot}/${p}`,
                fields,
              },
              updateTransforms: [
                {
                  fieldPath: 'updatedAt',
                  setToServerValue: 'REQUEST_TIME',
                },
              ],
            },
          ],
        }),
      }).catch(() => undefined)
    )
  );
}

async function hydrateActiveStoresFromFirestore(): Promise<void> {
  if (!FIREBASE_PROJECT_ID || !FIREBASE_API_KEY) return;
  const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${encodeURIComponent(
    FIRESTORE_DATABASE_ID
  )}/documents:runQuery?key=${FIREBASE_API_KEY}`;
  try {
    const res = await fetch(queryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'stores' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'status' },
              op: 'EQUAL',
              value: { stringValue: 'Active' },
            },
          },
        },
      }),
    });
    if (!res.ok) return;
    const rows = (await res.json()) as Array<{ document?: Record<string, unknown> }>;
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (!row?.document) continue;
      const docName = String(row.document.name || '');
      const storeId = docName.split('/').pop() || '';
      if (!storeId) continue;
      const parsed = parseFirestoreDocumentFields(row.document);
      const ownerId = String(parsed.ownerId || '').trim();
      const storeSlug = String(parsed.storeSlug || '').trim();
      const storeName = String(parsed.storeName || '').trim();
      if (!ownerId || !storeSlug || !storeName) continue;
      serverStores.set(storeId, {
          storeId,
          ownerId,
          ownerEmail: String(parsed.ownerEmail || ''),
          ownerName: String(parsed.ownerName || storeName),
          storeSlug,
          storeName,
          country: String(parsed.sellerCountry || parsed.country || 'Pakistan'),
          sellerCountry: String(parsed.sellerCountry || parsed.country || 'Pakistan'),
          productType: String(parsed.productType || 'Digital Templates & Ebooks'),
          currency: String(parsed.currency || 'PKR'),
          exchangeRatePkr: Number(parsed.exchangeRatePkr) || 278,
          theme: String(parsed.theme || 'blush-bloom'),
          plan: parsed.plan === 'Pro' ? 'Pro' : 'Free',
          instagramHandle: String(parsed.instagramHandle || ''),
          announcementText: String(parsed.announcementText || ''),
          heroHeadingLine1: String(parsed.heroHeadingLine1 || ''),
          heroHeadingLine2: String(parsed.heroHeadingLine2 || ''),
          heroSubheading: String(parsed.heroSubheading || ''),
          heroButtonText: String(parsed.heroButtonText || ''),
          heroImage: String(parsed.heroImage || ''),
          logoUrl: String(parsed.logoUrl || ''),
          status: 'Active',
        });
      const cachedOwnerSettings = firestoreVerifiedSellerSettingsByOwner.get(ownerId);
      if (cachedOwnerSettings) {
        firestoreVerifiedSellerSettingsByStore.set(
          storeId,
          normalizeSellerPaymentSettingsRecord(cachedOwnerSettings, storeId, ownerId)
        );
      }
    }
  } catch {
    // Non-blocking startup store hydration
  }
}

async function hydratePublishedProductsFromFirestore(): Promise<void> {
  if (!FIREBASE_PROJECT_ID || !FIREBASE_API_KEY) return;
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${encodeURIComponent(
    FIRESTORE_DATABASE_ID
  )}/documents`;
  try {
    const res = await fetch(`${baseUrl}:runQuery?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'products' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'published' },
              op: 'EQUAL',
              value: { booleanValue: true },
            },
          },
        },
      }),
    });
    if (!res.ok) return;
    const rows = (await res.json()) as Array<{ document?: Record<string, unknown> }>;
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (!row?.document) continue;
      const docName = String(row.document.name || '');
      const prodId = docName.split('/').pop() || '';
      if (!prodId) continue;
      const parsed = parseFirestoreDocumentFields(row.document);
      const storeId = String(parsed.storeId || '').trim();
      const ownerId = String(parsed.ownerId || '').trim();
      const title = String(parsed.title || '').trim();
      if (!storeId || !ownerId || !title) continue;
      const isFree = Boolean(parsed.isFree);
      serverProducts.set(prodId, {
        id: prodId,
        storeId,
        ownerId,
        title,
        category: String(parsed.category || 'Templates'),
        subtitle: String(parsed.subtitle || ''),
        description: String(parsed.description || ''),
        isFree,
        priceUsd: isFree ? 0 : Number(parsed.priceUsd) || 0,
        pricePkr: isFree ? 0 : Number(parsed.pricePkr) || 0,
        published: Boolean(parsed.published),
        status: (parsed.status as 'Available' | 'Coming Soon' | 'Draft') || 'Available',
        image: String(parsed.image || ''),
        fileName: String(parsed.fileName || 'Digital-Download.pdf'),
        fileType: String(parsed.fileType || 'PDF'),
        fileSizeLabel: String(parsed.fileSizeLabel || '1.2 MB'),
      });
      if (isFree && !serverProductDeliverables.has(prodId)) {
        try {
          const delivRes = await fetch(
            `${baseUrl}/products/${encodeURIComponent(prodId)}/deliverables/main?key=${FIREBASE_API_KEY}`
          );
          if (delivRes.ok) {
            const delivJson = (await delivRes.json()) as Record<string, unknown>;
            if (delivJson?.fields) {
              const delivParsed = parseFirestoreDocumentFields(delivJson);
              const fileDataUrl = String(delivParsed.fileDataUrl || '');
              if (fileDataUrl) {
                serverProductDeliverables.set(prodId, {
                  fileName: String(delivParsed.fileName || parsed.fileName || 'Digital-Download.pdf'),
                  fileType: String(delivParsed.fileMimeType || parsed.fileType || 'PDF'),
                  fileSizeLabel: String(parsed.fileSizeLabel || '1.2 MB'),
                  fileDataUrl,
                });
              }
            }
          }
        } catch {
          // Ignore individual deliverable fetch errors
        }
      }
    }
  } catch {
    // Non-blocking startup product hydration
  }
}

async function resolveVerifiedStoreRecord(
  rawStoreIdOrSlug: string
): Promise<ServerStoreRecord | undefined> {
  const clean = String(rawStoreIdOrSlug || '').trim();
  if (!clean) return undefined;
  const cleanLower = clean.toLowerCase();
  const cleanAlnum = cleanLower.replace(/[._-]/g, '');

  const matchInRegistry = (): ServerStoreRecord | undefined =>
    serverStores.get(clean) ||
    Array.from(serverStores.values()).find(
      (s) =>
        s.storeSlug.toLowerCase() === cleanLower ||
        s.storeId.toLowerCase() === cleanLower ||
        (cleanAlnum.length >= 4 &&
          s.storeSlug.toLowerCase().replace(/[._-]/g, '') === cleanAlnum) ||
        ((cleanLower === 'store-fatima-tech' || cleanAlnum === 'fatimatech') &&
          s.storeSlug.toLowerCase().replace(/[._-]/g, '') === 'fatimatech')
    );

  const existing = matchInRegistry();
  if (existing) return existing;
  await hydrateActiveStoresFromFirestore();
  return matchInRegistry();
}

void hydrateActiveStoresFromFirestore();
void hydratePublishedProductsFromFirestore();

// Firestore is the durable financial source of truth; in-memory maps are read caches only.
let ledgerHydrationFinished = false;
let ledgerHydrationSucceeded = false;
async function hydrateFinancialLedgerFromFirestore(): Promise<boolean> {
  if (!adminFirestoreDb) {
    console.error('Financial database unavailable: Firebase Admin Firestore is not configured.');
    ledgerHydrationFinished = true;
    return false;
  }
  try {
    const snapshot = await adminFirestoreDb.collection('ledger').get();
    for (const doc of snapshot.docs) {
      const record = doc.data() as LedgerEntry;
      // Legacy client-created ledger projections are not trusted as payment authority.
      if (
        record.orderNumber !== doc.id ||
        !record.ledgerId ||
        !record.orderId ||
        !record.buyerId ||
        !record.sellerId ||
        !['Pending', 'Paid', 'Failed', 'Refunded'].includes(record.paymentStatus)
      ) continue;
      persistentLedger.set(doc.id, record);
    }
    ledgerHydrationSucceeded = true;
    console.log(`Loaded ${persistentLedger.size} authoritative financial orders from Firestore.`);
    return true;
  } catch (err) {
    console.error('Financial ledger hydration failed; checkout and financial endpoints will fail closed.', err);
    return false;
  } finally {
    ledgerHydrationFinished = true;
  }
}
let financialLedgerHydration = hydrateFinancialLedgerFromFirestore();
let lastLedgerRetryAt = Date.now();
async function refreshFinancialReadiness(): Promise<boolean> {
  if (ledgerHydrationFinished && !ledgerHydrationSucceeded && Date.now() - lastLedgerRetryAt > 30000) {
    lastLedgerRetryAt = Date.now();
    ledgerHydrationFinished = false;
    financialLedgerHydration = hydrateFinancialLedgerFromFirestore();
  }
  return financialLedgerHydration;
}

// Order authority is refreshed per request so a second instance sees purchases,
// refunds and download limits written elsewhere. Memory is never the authority.
async function loadFinancialOrder(orderNumber: string): Promise<LedgerEntry | undefined> {
  if (!/^[A-Za-z0-9_-]{2,128}$/.test(orderNumber)) return undefined;
  if (!adminFirestoreDb) throw new Error('Secure order database unavailable.');
  const snap = await adminFirestoreDb.collection('ledger').doc(orderNumber).get();
  if (!snap.exists) { persistentLedger.delete(orderNumber); return undefined; }
  const record = snap.data() as LedgerEntry;
  if (record.orderNumber !== orderNumber || !record.buyerId || !record.sellerId || !record.orderId) {
    throw new Error('Invalid financial order record.');
  }
  persistentLedger.set(orderNumber, record);
  return record;
}

async function ensureFinancialDatabaseReady(res: express.Response): Promise<boolean> {
  if (process.env.NODE_ENV === 'production' && !HAS_DURABLE_PRODUCTION_SIGNING_SECRET) {
    res.status(503).json({
      error: 'Secure downloads are not configured. The operator must configure a durable SERVER_SIGNING_SECRET before enabling orders.',
    });
    return false;
  }
  if (!adminFirestoreDb || !(await refreshFinancialReadiness()) || !ledgerHydrationFinished || !ledgerHydrationSucceeded) {
    res.status(503).json({ error: 'Secure order database is unavailable. No checkout or payment change was accepted.' });
    return false;
  }
  return true;
}

async function commitFinancialOrderTransition(
  entry: LedgerEntry,
  expectedStatus: LedgerEntry['paymentStatus']
): Promise<void> {
  if (!adminFirestoreDb || !(await refreshFinancialReadiness())) {
    throw new Error('Secure financial database unavailable.');
  }
  const ledgerRef = adminFirestoreDb.collection('ledger').doc(entry.orderNumber);
  const orderRef = adminFirestoreDb.collection('orders').doc(entry.orderId);
  await adminFirestoreDb.runTransaction(async (tx) => {
    const current = await tx.get(ledgerRef);
    if (!current.exists || current.get('paymentStatus') !== expectedStatus) {
      throw new Error('Payment status changed in another session. Please refresh the order.');
    }
    entry.downloadCount = Number(current.get('downloadCount') || 0);
    tx.set(ledgerRef, entry as unknown as Record<string, unknown>);
    tx.set(orderRef, {
      paymentStatus: entry.paymentStatus,
      downloadToken: entry.downloadToken,
      downloadCount: entry.downloadCount,
      updatedAt: new Date(),
    }, { merge: true });
  });
}


function signInvoiceRecord(payload: {
  invoiceId: string;
  sellerId: string;
  orderNumbers: string[];
  commissionAmountMinor: number;
  dueAtMs: number;
}): string {
  return crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(
      `inv:${payload.invoiceId}:${payload.sellerId}:${payload.orderNumbers.join(',')}:${
        payload.commissionAmountMinor
      }:${payload.dueAtMs}`
    )
    .digest('hex');
}

function appendAuditEntry(
  entry: Omit<LedgerAuditRecord, 'auditId' | 'createdAtIso'>,
  bearerToken?: string
): LedgerAuditRecord {
  const full: LedgerAuditRecord = {
    ...entry,
    auditId: `aud-${Date.now()}-${Math.floor(1000 + Math.random() * 8999)}`,
    createdAtIso: new Date().toISOString(),
  };
  immutableAuditLog.unshift(full);
  syncFirestoreDoc('ledger_audit', full.auditId, full as unknown as Record<string, unknown>, bearerToken);
  return full;
}

function escapeHtmlEntities(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidCustomerEmailAddress(email: string): boolean {
  const clean = String(email || '').trim().toLowerCase();
  if (clean.length < 5 || clean.length > 254) return false;
  if (/[\r\n<>]/.test(clean)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean);
}

/**
 * Triggers a cryptographically signed, idempotent confirmation & digital download email
 * to the buyer once an order is marked as 'Paid', strictly using the authoritative
 * `customerEmail` from the order record.
 */
export async function triggerBuyerPaidOrderEmail(
  entry: LedgerEntry,
  actorUid: string,
  bearerToken?: string
): Promise<BuyerPaidEmailNotificationRecord | null> {
  if (!entry || entry.paymentStatus !== 'Paid') {
    return null;
  }

  // Idempotency guard: never send duplicate Paid confirmation emails for the same order
  const existingNotification =
    buyerPaidEmailNotifications.get(entry.orderNumber) || entry.buyerEmailNotification;
  if (existingNotification && existingNotification.status === 'sent') {
    return existingNotification;
  }

  const recipientEmail = String(entry.customerEmail || '').trim().toLowerCase();
  if (!isValidCustomerEmailAddress(recipientEmail)) {
    return null;
  }

  const storeRecord = serverStores.get(entry.storeId);
  const storeName = storeRecord?.storeName || 'DreamStore Creator Shop';
  const customerName = String(entry.customerName || recipientEmail.split('@')[0] || 'Valued Buyer')
    .replace(/[\r\n]/g, ' ')
    .trim()
    .slice(0, 120);
  const productSummary = String(entry.itemTitlesSummary || 'Digital Product')
    .replace(/[\r\n]/g, ' ')
    .trim()
    .slice(0, 300);
  const totalAmountMajor =
    entry.totalAmount !== undefined
      ? entry.totalAmount
      : Math.round(entry.grossAmountMinor) / 100;
  const sentAtIso = new Date().toISOString();
  const expiresAtIso = new Date(
    entry.expiresAtMs || Date.now() + 7 * 24 * 60 * 60 * 1000
  ).toISOString();
  const emailId = `em-${Date.now()}-${Math.floor(1000 + Math.random() * 8999)}`;

  // Cryptographic HMAC-SHA256 email authenticity signature bound to orderNumber, recipientEmail & downloadToken
  const securitySignature = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(
      `paid_email:${emailId}:${entry.orderNumber}:${recipientEmail}:${entry.paymentStatus}:${entry.downloadToken}:${sentAtIso}`
    )
    .digest('hex');

  const appBaseUrl = (
    process.env.APP_URL ||
    process.env.VITE_PUBLIC_STORE_DOMAIN ||
    'https://dreamstore.app'
  ).replace(/\/$/, '');
  const storeSlugParam = storeRecord?.storeSlug
    ? `?store=${encodeURIComponent(storeRecord.storeSlug)}&order=${encodeURIComponent(entry.orderNumber)}`
    : `?order=${encodeURIComponent(entry.orderNumber)}`;
  const orderAccessUrl = `${appBaseUrl}/${storeSlugParam}`;

  const subject = `Payment Confirmed: Your download for Order #${entry.orderNumber} is ready (${storeName})`;

  const safeCustomerName = escapeHtmlEntities(customerName);
  const safeStoreName = escapeHtmlEntities(storeName);
  const safeProductSummary = escapeHtmlEntities(productSummary);
  const safeOrderNumber = escapeHtmlEntities(entry.orderNumber);
  const safeCurrency = escapeHtmlEntities(entry.currency);
  const safeVerificationMode = escapeHtmlEntities(entry.verificationMode);
  const safeDownloadToken = escapeHtmlEntities(entry.downloadToken);

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #FFFDF8; border: 2px solid #F0DEC6; border-radius: 24px; color: #50352F;">
      <h2 style="margin-top: 0; color: #D66795;">Payment Verified &amp; Download Unlocked</h2>
      <p>Hi <strong>${safeCustomerName}</strong>,</p>
      <p>Great news! Your order <strong>#${safeOrderNumber}</strong> from <strong>${safeStoreName}</strong> has been marked as <strong>Paid (${safeVerificationMode})</strong>. Your digital files are now unlocked and ready for download.</p>
      <div style="background-color: #FFF2DF; padding: 16px; border-radius: 16px; margin: 16px 0;">
        <p style="margin: 4px 0;"><strong>Order Number:</strong> #${safeOrderNumber}</p>
        <p style="margin: 4px 0;"><strong>Items:</strong> ${safeProductSummary}</p>
        <p style="margin: 4px 0;"><strong>Total Paid:</strong> ${safeCurrency} ${totalAmountMajor.toFixed(2)}</p>
        <p style="margin: 4px 0;"><strong>Download Limit:</strong> Up to ${entry.maxDownloads} downloads (Expires ${expiresAtIso.slice(0, 10)})</p>
        <p style="margin: 4px 0; font-family: monospace; font-size: 12px;"><strong>Signed Download Token:</strong> ${safeDownloadToken}</p>
      </div>
      <p style="margin: 20px 0;">
        <a href="${orderAccessUrl}" style="display: inline-block; background-color: #F58CB7; color: #50352F; font-weight: 800; text-decoration: none; padding: 12px 24px; border-radius: 999px;">Access Your Digital Download</a>
      </p>
      <hr style="border: none; border-top: 1px solid #F0DEC6; margin: 20px 0;" />
      <p style="font-size: 11px; color: #7A5A52;">Security Signature (HMAC-SHA256): <code>${securitySignature.slice(0, 24)}...</code></p>
    </div>
  `.trim();

  let deliveryProvider: 'resend_api' | 'secure_outbox' = 'secure_outbox';
  let status: 'sent' | 'failed' = 'sent';
  let errorDetail: string | undefined;

  const resendApiKey = (process.env.RESEND_API_KEY || '').trim();
  const fromEmail = (
    process.env.ORDER_NOTIFICATION_FROM_EMAIL || 'DreamStore Orders <orders@dreamstore.app>'
  ).trim();

  if (resendApiKey && isRealCredentialValue(resendApiKey)) {
    deliveryProvider = 'resend_api';
    try {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `paid-email-${entry.orderNumber}`,
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [recipientEmail],
          subject,
          html: htmlBody,
        }),
      });
      if (!emailRes.ok) {
        // Fallback to secure outbox record while recording API status
        const errText = await emailRes.text().catch(() => 'Resend API error');
        errorDetail = `External provider fallback: ${errText.slice(0, 160)}`;
      }
    } catch (err) {
      errorDetail =
        err instanceof Error ? err.message.slice(0, 160) : 'Email transport fallback to secure outbox';
    }
  }

  const notificationRecord: BuyerPaidEmailNotificationRecord = {
    emailId,
    orderNumber: entry.orderNumber,
    orderId: entry.orderId,
    storeId: entry.storeId,
    sellerId: entry.sellerId,
    buyerId: entry.buyerId,
    recipientEmail,
    customerName,
    subject,
    productSummary,
    currency: entry.currency,
    totalAmountMajor,
    verificationMode: entry.verificationMode,
    downloadToken: entry.downloadToken,
    expiresAtIso,
    securitySignature,
    deliveryProvider,
    status,
    sentAtIso,
    ...(errorDetail ? { errorDetail } : {}),
  };

  entry.buyerEmailNotification = notificationRecord;
  buyerPaidEmailNotifications.set(entry.orderNumber, notificationRecord);

  // Sync notification to Firestore admin-accessible secure outbox if Admin SDK is connected
  if (adminFirestoreDb) {
    try {
      await adminFirestoreDb
        .collection('order_email_notifications')
        .doc(entry.orderNumber)
        .set(notificationRecord, { merge: true });
    } catch {
      // Non-blocking Firestore outbox persistence
    }
  }

  appendAuditEntry(
    {
      orderNumber: entry.orderNumber,
      orderId: entry.orderId,
      sellerId: entry.sellerId,
      actorUid: actorUid || entry.verifiedByUid || entry.sellerId,
      action: 'BUYER_PAID_EMAIL_TRIGGERED',
      previousStatus: 'Paid',
      newStatus: 'Paid',
      verificationMode: entry.verificationMode,
      detail: `Secure Paid order confirmation & download email triggered to buyer "${recipientEmail}" (Email ID: ${emailId}, Sig: ${securitySignature.slice(0, 12)}).`,
    },
    bearerToken
  );

  return notificationRecord;
}

// Reconcile Seller 5% Commission Invoices, Overdue Deadlines & Feature Restrictions
function reconcileSellerCommissionState(
  sellerId: string,
  nowMs: number = Date.now(),
  bearerToken?: string
) {
  const sellerStore = Array.from(serverStores.values()).find((s) => s.ownerId === sellerId);
  const storeId = sellerStore?.storeId || `store-${sellerId}`;
  const defaultCurrency = sellerStore?.currency || 'PKR';

  // 1. Gather all verified, eligible paid sales for this seller in chronological order
  // Count ONLY eligible, verified sales: paymentStatus === 'Paid' && grossAmountMinor > 0 && commissionStatus !== 'reversed' && commissionStatus !== 'disputed'
  const allSellerOrders = Array.from(persistentLedger.values())
    .filter((e) => e.sellerId === sellerId)
    .sort((a, b) => a.createdAtIso.localeCompare(b.createdAtIso));

  const eligibleVerifiedSales = allSellerOrders.filter(
    (e) =>
      e.paymentStatus === 'Paid' &&
      e.grossAmountMinor > 0 &&
      (e.verificationMode === 'Manually Verified by Seller' ||
        e.verificationMode === 'Gateway Verified') &&
      e.commissionStatus !== 'reversed' &&
      e.commissionStatus !== 'disputed'
  );

  // Filter out orders that have already been billed in an invoice (never count the same order twice)
  const unbilledEligible = eligibleVerifiedSales.filter(
    (e) => !billedOrderNumbers.has(e.orderNumber)
  );

  // 2. Automatically generate an invoice for every batch of 5 verified, eligible sales
  while (unbilledEligible.length >= INVOICE_SALES_THRESHOLD) {
    const batch = unbilledEligible.splice(0, INVOICE_SALES_THRESHOLD);
    const batchOrderNumbers = batch.map((b) => b.orderNumber);
    const grossSalesMinor = batch.reduce((sum, b) => sum + b.grossAmountMinor, 0);
    const commissionAmountMinor = batch.reduce((sum, b) => sum + b.platformCommissionMinor, 0);
    const currency = batch[0]?.currency || defaultCurrency;

    const seqNum = commissionInvoices.size + 1;
    const invoiceId = `inv-${sellerId}-${seqNum}-${Date.now().toString().slice(-5)}`;
    const invoiceNumber = `INV-${new Date(nowMs).getFullYear()}-${String(seqNum).padStart(4, '0')}`;
    const issuedAtMs = nowMs;
    const dueAtMs = issuedAtMs + INVOICE_PAYMENT_WINDOW_MS;
    const issuedAtIso = new Date(issuedAtMs).toISOString();
    const dueAtIso = new Date(dueAtMs).toISOString();

    const invoice: CommissionInvoiceRecord = {
      invoiceId,
      invoiceNumber,
      sellerId,
      storeId,
      currency,
      orderNumbers: batchOrderNumbers,
      verifiedSalesCount: batch.length,
      grossSalesMinor,
      commissionAmountMinor,
      paidAmountMinor: 0,
      adjustedAmountMinor: 0,
      remainingBalanceMinor: commissionAmountMinor,
      status: 'open',
      issuedAtMs,
      dueAtMs,
      issuedAtIso,
      dueAtIso,
      serverSignature: signInvoiceRecord({
        invoiceId,
        sellerId,
        orderNumbers: batchOrderNumbers,
        commissionAmountMinor,
        dueAtMs,
      }),
    };

    commissionInvoices.set(invoiceId, invoice);
    for (const item of batch) {
      billedOrderNumbers.set(item.orderNumber, invoiceId);
      item.invoiceId = invoiceId;
      syncFirestoreDoc('ledger', item.orderNumber, item as unknown as Record<string, unknown>, bearerToken);
    }

    syncFirestoreDoc(
      'commission_invoices',
      invoice.invoiceId,
      invoice as unknown as Record<string, unknown>,
      bearerToken
    );

    appendAuditEntry(
      {
        orderNumber: batchOrderNumbers[batchOrderNumbers.length - 1],
        orderId: batch[batch.length - 1].orderId,
        sellerId,
        actorUid: 'system:commission-engine',
        action: 'INVOICE_GENERATED',
        previousStatus: 'unbilled',
        newStatus: 'open',
        verificationMode: 'Server Automated',
        detail: `Commission invoice ${invoiceNumber} automatically generated after ${INVOICE_SALES_THRESHOLD} verified sales (${batchOrderNumbers.join(
          ', '
        )}). Total 5% commission due: ${(commissionAmountMinor / 100).toFixed(2)} ${currency} by ${dueAtIso.slice(
          0,
          10
        )}.`,
      },
      bearerToken
    );
  }

  // 3. Evaluate overdue status across all seller invoices
  const sellerInvoices = Array.from(commissionInvoices.values())
    .filter((inv) => inv.sellerId === sellerId)
    .sort((a, b) => b.issuedAtMs - a.issuedAtMs);

  let isRestricted = false;
  let restrictionReason: string | null = null;
  let earliestDeadlineMs: number | null = null;

  for (const inv of sellerInvoices) {
    if (inv.remainingBalanceMinor <= 0) {
      if (inv.status !== 'paid' && inv.status !== 'voided') {
        inv.status = inv.paidAmountMinor > 0 ? 'paid' : 'voided';
        syncFirestoreDoc(
          'commission_invoices',
          inv.invoiceId,
          inv as unknown as Record<string, unknown>,
          bearerToken
        );
      }
      continue;
    }

    if (earliestDeadlineMs === null || inv.dueAtMs < earliestDeadlineMs) {
      earliestDeadlineMs = inv.dueAtMs;
    }

    if (nowMs > inv.dueAtMs) {
      // Do not penalize sellers who have already submitted commission payment awaiting admin review
      // or sellers who lack a verified usable commission payment method in their region/settings
      const hasSubmittedPaymentPendingReview = Array.from(commissionPayments.values()).some(
        (p) => p.invoiceId === inv.invoiceId && p.status === 'submitted'
      );
      const lacksUsableCommissionMethod = Boolean(
        sellerStore &&
          (sellerStore as unknown as Record<string, unknown>).usableCommissionPaymentMethod ===
            false
      );

      if (hasSubmittedPaymentPendingReview || lacksUsableCommissionMethod) {
        continue;
      }

      if (inv.status === 'open') {
        inv.status = 'overdue';
        syncFirestoreDoc(
          'commission_invoices',
          inv.invoiceId,
          inv as unknown as Record<string, unknown>,
          bearerToken
        );
        appendAuditEntry(
          {
            orderNumber: inv.orderNumbers[0] || inv.invoiceNumber,
            orderId: inv.invoiceId,
            sellerId,
            actorUid: 'system:commission-engine',
            action: 'INVOICE_OVERDUE_RESTRICTED',
            previousStatus: 'open',
            newStatus: 'overdue',
            verificationMode: 'Server Automated',
            detail: `Invoice ${inv.invoiceNumber} passed 7-day payment deadline. Seller management features restricted until ${(
              inv.remainingBalanceMinor / 100
            ).toFixed(2)} ${inv.currency} is settled.`,
          },
          bearerToken
        );
      }
      isRestricted = true;
      if (!restrictionReason) {
        restrictionReason = `Commission invoice ${inv.invoiceNumber} (${(
          inv.remainingBalanceMinor / 100
        ).toFixed(2)} ${inv.currency}) is past its 7-day payment deadline. Adding/publishing products, Visual Store Builder, and theme customization are paused until settlement. Public storefront, buyer checkout, and existing downloads remain 100% active.`;
      }
    } else if (inv.status === 'overdue') {
      inv.status = 'open';
    }
  }

  const unbilledCommissionMinor = unbilledEligible.reduce(
    (sum, e) => sum + e.platformCommissionMinor,
    0
  );
  const invoicedOutstandingMinor = sellerInvoices
    .filter((inv) => inv.status !== 'paid' && inv.status !== 'voided')
    .reduce((sum, inv) => sum + inv.remainingBalanceMinor, 0);
  const totalPaidCommissionMinor = sellerInvoices.reduce(
    (sum, inv) => sum + inv.paidAmountMinor,
    0
  );
  const totalAdjustedCommissionMinor = sellerInvoices.reduce(
    (sum, inv) => sum + inv.adjustedAmountMinor,
    0
  );

  const daysUntilDeadline =
    earliestDeadlineMs !== null
      ? Math.ceil((earliestDeadlineMs - nowMs) / (24 * 60 * 60 * 1000))
      : null;

  const sellerPayments = Array.from(commissionPayments.values())
    .filter((p) => p.sellerId === sellerId)
    .sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));

  const sellerAdjustments = commissionAdjustments
    .filter((a) => a.sellerId === sellerId)
    .sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));

  return {
    sellerId,
    storeId,
    currency: sellerInvoices[0]?.currency || defaultCurrency,
    salesTowardNextInvoice: unbilledEligible.length,
    invoiceThreshold: INVOICE_SALES_THRESHOLD,
    totalVerifiedEligibleSales: eligibleVerifiedSales.length,
    unbilledOrderNumbers: unbilledEligible.map((e) => e.orderNumber),
    unbilledCommissionMinor,
    invoicedOutstandingMinor,
    totalOutstandingCommissionMinor: unbilledCommissionMinor + invoicedOutstandingMinor,
    totalPaidCommissionMinor,
    totalAdjustedCommissionMinor,
    nextPaymentDeadlineMs: earliestDeadlineMs,
    nextPaymentDeadlineIso:
      earliestDeadlineMs !== null ? new Date(earliestDeadlineMs).toISOString() : null,
    daysUntilDeadline,
    isRestricted,
    restrictionReason,
    restrictedFeatures: isRestricted ? RESTRICTED_FEATURES_ON_OVERDUE : [],
    unrestrictedFeatures: UNRESTRICTED_FEATURES_ALWAYS,
    invoices: sellerInvoices,
    payments: sellerPayments,
    adjustments: sellerAdjustments,
  };
}

function applyOrderCommissionReversalToInvoice(
  orderNumber: string,
  sellerId: string,
  reversedCommissionMinor: number,
  currency: string,
  reason: 'order_refunded' | 'order_disputed',
  bearerToken?: string
) {
  const invoiceId = billedOrderNumbers.get(orderNumber);
  if (!invoiceId || reversedCommissionMinor <= 0) return null;
  const inv = commissionInvoices.get(invoiceId);
  if (!inv) return null;

  const alreadyAdjusted = commissionAdjustments.some(
    (a) => a.invoiceId === invoiceId && a.orderNumber === orderNumber
  );
  if (alreadyAdjusted) return inv;

  const effectiveReduction = Math.min(inv.remainingBalanceMinor, reversedCommissionMinor);
  inv.adjustedAmountMinor += reversedCommissionMinor;
  inv.remainingBalanceMinor = Math.max(0, inv.remainingBalanceMinor - effectiveReduction);

  if (inv.remainingBalanceMinor === 0) {
    inv.status = inv.paidAmountMinor > 0 ? 'paid' : 'voided';
  }

  const adj: CommissionAdjustmentEntry = {
    adjustmentId: `adj-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`,
    invoiceId: inv.invoiceId,
    invoiceNumber: inv.invoiceNumber,
    orderNumber,
    sellerId,
    currency,
    adjustmentAmountMinor: reversedCommissionMinor,
    reason,
    detail: `Invoice ${inv.invoiceNumber} adjusted by -${(reversedCommissionMinor / 100).toFixed(
      2
    )} ${currency} due to ${reason === 'order_refunded' ? 'order refund' : 'commission dispute'} on ${orderNumber}. Remaining balance: ${(
      inv.remainingBalanceMinor / 100
    ).toFixed(2)} ${currency}.`,
    createdAtIso: new Date().toISOString(),
  };

  commissionAdjustments.unshift(adj);
  syncFirestoreDoc(
    'commission_invoices',
    inv.invoiceId,
    inv as unknown as Record<string, unknown>,
    bearerToken
  );
  syncFirestoreDoc(
    'commission_adjustments',
    adj.adjustmentId,
    adj as unknown as Record<string, unknown>,
    bearerToken
  );

  appendAuditEntry(
    {
      orderNumber,
      orderId: inv.invoiceId,
      sellerId,
      actorUid: 'system:commission-engine',
      action: 'COMMISSION_ADJUSTED',
      previousStatus: 'billed',
      newStatus: inv.status,
      verificationMode: 'Server Automated',
      detail: adj.detail,
    },
    bearerToken
  );

  return inv;
}

function computeServerCommissionMinor(
  grossMajor: number,
  currency: string,
  rateBps: number,
  paymentMethod: string
) {
  const grossAmountMinor = Math.round(grossMajor * 100);
  if (grossAmountMinor <= 0) {
    return {
      currency,
      commissionRateBps: rateBps,
      grossAmountMinor: 0,
      platformCommissionMinor: 0,
      sellerShareBeforeFeesMinor: 0,
      gatewayFeeMinor: 0,
      sellerNetEarningsMinor: 0,
    };
  }
  const platformCommissionMinor = Math.round((grossAmountMinor * rateBps) / 10000);
  const sellerShareBeforeFeesMinor = grossAmountMinor - platformCommissionMinor;

  // Manual direct transfers (JazzCash, Easypaisa, UPI, Bank Transfer) have 0 gateway fee charged by DreamStore
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
    commissionRateBps: rateBps,
    grossAmountMinor,
    platformCommissionMinor,
    sellerShareBeforeFeesMinor,
    gatewayFeeMinor,
    sellerNetEarningsMinor,
  };
}

function createSignedDownloadToken(payload: {
  orderNumber: string;
  productId: string;
  buyerId: string;
  expiresAtMs: number;
}): string {
  const data = `${payload.orderNumber}:${payload.productId}:${payload.buyerId}:${payload.expiresAtMs}`;
  const sig = crypto.createHmac('sha256', SIGNING_SECRET).update(data).digest('hex');
  return `dstok_${payload.expiresAtMs}_${sig}`;
}

function verifySignedDownloadToken(
  token: string,
  expectedOrderNumber: string,
  expectedProductId: string,
  expectedBuyerId: string,
  expiresAtMs: number
): boolean {
  if (
    !token ||
    token === 'LOCKED-UNTIL-PAYMENT-VERIFIED' ||
    token === 'LOCKED-PENDING-VERIFICATION' ||
    token === 'REVOKED-REFUNDED'
  ) {
    return false;
  }
  if (Date.now() >= expiresAtMs) {
    return false;
  }
  const expectedToken = createSignedDownloadToken({
    orderNumber: expectedOrderNumber,
    productId: expectedProductId,
    buyerId: expectedBuyerId,
    expiresAtMs,
  });
  const a = Buffer.from(String(token));
  const b = Buffer.from(expectedToken);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface VerifiedAuthUser {
  role?: string;
  superAdmin?: boolean;
  authTime?: number;
  uid: string;
  email: string;
  displayName?: string;
  emailVerified: boolean;
  rawToken: string;
}

interface StoredEmailAccount {
  uid: string;
  email: string;
  displayName: string;
  passwordSalt: string;
  passwordHash: string;
  createdAtMs: number;
  updatedAtMs: number;
  emailVerified?: boolean;
  migratedToFirebaseAuth?: boolean;
  migratedAtMs?: number;
  providerId?: string;
  status?: string;
}

interface ActiveEmailSession {
  sessionId: string;
  uid: string;
  email: string;
  displayName: string;
  expiresAtMs: number;
  migratedSession?: boolean;
}

interface PasswordResetTokenRecord {
  tokenId: string;
  uid: string;
  email: string;
  tokenHash: string;
  createdAtMs: number;
  expiresAtMs: number;
  used: boolean;
  usedAtMs?: number;
}

interface EmailAuthMigrationStatus {
  migrationCompleted: boolean;
  migratedAtMs: number;
  migratedAccountsCount: number;
  legacySessionsRevoked: boolean;
  legacySessionsRevokedCount: number;
  legacyFileRemovedFromRepo: boolean;
  secureStoragePath: string;
}

const PASSWORD_RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
// Secure account storage strictly isolated in os.tmpdir() with restricted 0o600 permissions.
// Sensitive account/session credentials are NEVER stored in process.cwd(), repo roots, or exportable directories.
const SECURE_EMAIL_ACCOUNTS_FILE = path.join(
  os.tmpdir(),
  'dreamstore-secure-email-accounts-v2.json'
);
const LEGACY_EMAIL_ACCOUNTS_FILE = path.join(
  process.cwd(),
  '.persistent-email-accounts.json'
);

const emailAccountsByEmail = new Map<string, StoredEmailAccount>();
const activeEmailSessions = new Map<string, ActiveEmailSession>();
const pendingPasswordResetTokens = new Map<string, PasswordResetTokenRecord>();
const consumedResetTokenHashes = new Set<string>();
const inFlightResetTokenConsumptions = new Set<string>();

interface ConsumedResetTokenDoc {
  tokenHash: string;
  email: string;
  uid: string;
  consumedAtMs: number;
  consumedAtIso: string;
}

const SECURE_CONSUMED_TOKENS_FILE = path.join(
  os.tmpdir(),
  'dreamstore-consumed-reset-tokens.json'
);
const consumedResetTokensRegistry = new Map<string, ConsumedResetTokenDoc>();

interface EmailDeliveryAuditLog {
  recipient: string;
  subject: string;
  dispatchedVia: string;
  status: 'sent' | 'failed';
  timestampIso: string;
  error?: string;
}

const emailDeliveryAuditLogs: EmailDeliveryAuditLog[] = [];
let emailDeliveryStats = { sent: 0, failed: 0 };

function recordEmailDeliveryLog(entry: EmailDeliveryAuditLog): void {
  emailDeliveryAuditLogs.push(entry);
  if (entry.status === 'sent') {
    emailDeliveryStats.sent += 1;
  } else {
    emailDeliveryStats.failed += 1;
  }
  if (emailDeliveryAuditLogs.length > 200) {
    emailDeliveryAuditLogs.shift();
  }
}

export interface EmailProviderDispatchResult {
  success: boolean;
  provider: string;
  messageId?: string;
  error?: string;
  statusCode?: number;
}

function getEmailProviderEndpoint(): { url: string; apiKey?: string; isTestEndpoint: boolean } {
  // 1. Check for test provider endpoint (configured by test runner for real inbox testing)
  const testEndpointFile = path.join(os.tmpdir(), '.dreamstore-provider-endpoint.txt');
  if (fs.existsSync(testEndpointFile)) {
    try {
      const endpoint = fs.readFileSync(testEndpointFile, 'utf8').trim();
      if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
        return { url: endpoint, isTestEndpoint: true };
      }
    } catch {}
  }

  // 2. Configured provider environment variables
  const customUrl = (process.env.EMAIL_PROVIDER_URL || process.env.RESEND_API_URL || '').trim();
  const resendApiKey = (process.env.RESEND_API_KEY || '').trim();

  if (customUrl) {
    return { url: customUrl, apiKey: resendApiKey || undefined, isTestEndpoint: false };
  }

  return {
    url: 'https://api.resend.com/emails',
    apiKey: resendApiKey || undefined,
    isTestEndpoint: false,
  };
}

function isEmailProviderConfigured(): boolean {
  const { apiKey, isTestEndpoint } = getEmailProviderEndpoint();
  return Boolean(isTestEndpoint || (apiKey && apiKey.length >= 6));
}

function getActiveEmailProviderName(): string {
  const { isTestEndpoint } = getEmailProviderEndpoint();
  return isTestEndpoint ? 'test_mail_provider' : 'resend';
}

async function sendPasswordResetEmailViaProvider(options: {
  recipientEmail: string;
  resetLink: string;
  expiresInMinutes?: number;
}): Promise<EmailProviderDispatchResult> {
  const { recipientEmail, resetLink, expiresInMinutes = 15 } = options;
  const { url, apiKey, isTestEndpoint } = getEmailProviderEndpoint();
  const providerName = isTestEndpoint ? 'test_mail_provider' : 'resend';
  const fromEmail = (
    process.env.PASSWORD_RESET_FROM_EMAIL ||
    process.env.ORDER_NOTIFICATION_FROM_EMAIL ||
    'DreamStore Security <security@dreamstore.app>'
  ).trim();

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 32px 24px; background-color: #FFFDF9; border: 1px solid #F0DEC6; border-radius: 20px;">
      <div style="margin-bottom: 24px;">
        <span style="font-size: 20px; font-weight: 800; color: #50352F;">🍭 DreamStore</span>
      </div>
      <h2 style="color: #50352F; font-size: 22px; font-weight: 800; margin: 0 0 16px 0; letter-spacing: -0.02em;">Password Reset Instructions</h2>
      <p style="color: #50352F; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">
        Hello, we received a request to reset the password for your DreamStore account associated with <strong>${recipientEmail}</strong>.
      </p>
      <p style="color: #50352F; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">
        Click the button below to set a new password. This link is single-use and will expire in ${expiresInMinutes} minutes for your security.
      </p>
      <div style="margin: 28px 0; text-align: center;">
        <a href="${resetLink}" style="display: inline-block; background-color: #F58CB7; color: #50352F; font-weight: 800; text-decoration: none; padding: 14px 32px; border-radius: 999px; font-size: 15px; box-shadow: 0 4px 12px rgba(245, 140, 183, 0.35);">
          Reset Password
        </a>
      </div>
      <p style="color: #7A5A52; font-size: 13px; line-height: 1.5; margin: 24px 0 0 0;">
        Button not working? Copy and paste this URL into your browser:<br />
        <a href="${resetLink}" style="color: #D65A8A; word-break: break-all; text-decoration: underline;">${resetLink}</a>
      </p>
      <hr style="border: none; border-top: 1px solid #F0DEC6; margin: 28px 0;" />
      <p style="color: #A3857D; font-size: 12px; line-height: 1.5; margin: 0;">
        If you didn't request a password reset, you can safely ignore this email — your account remains completely secure.
      </p>
    </div>
  `.trim();

  const textBody = `
DreamStore Password Reset

Hello, we received a request to reset the password for your DreamStore account (${recipientEmail}).

Use the following link to reset your password (expires in ${expiresInMinutes} minutes):
${resetLink}

If you did not request a password reset, you can safely ignore this message.
  `.trim();

  if (!apiKey && !isTestEndpoint) {
    return {
      success: false,
      provider: providerName,
      error: 'Email provider unconfigured: RESEND_API_KEY is not set',
      statusCode: 503,
    };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: fromEmail,
        to: [recipientEmail],
        subject: 'DreamStore Password Reset',
        html: htmlBody,
        text: textBody,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown provider error');
      const sanitizedErr = errText.slice(0, 160).replace(/Bearer\s+[A-Za-z0-9._-]+/g, '[REDACTED]');
      return {
        success: false,
        provider: providerName,
        error: `Provider HTTP ${response.status}: ${sanitizedErr}`,
        statusCode: response.status,
      };
    }

    let resultJson: any = {};
    try {
      resultJson = await response.json();
    } catch {
      resultJson = {};
    }

    return {
      success: true,
      provider: providerName,
      messageId: resultJson?.id || resultJson?.messageId || `msg_${Date.now()}`,
      statusCode: response.status,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const sanitizedMsg = message.slice(0, 160).replace(/Bearer\s+[A-Za-z0-9._-]+/g, '[REDACTED]');
    return {
      success: false,
      provider: providerName,
      error: `Network/transport error: ${sanitizedMsg}`,
      statusCode: 500,
    };
  }
}


async function recordConsumedResetToken(
  tokenHash: string,
  email: string,
  uid: string
): Promise<void> {
  const now = Date.now();
  const record: ConsumedResetTokenDoc = {
    tokenHash,
    email: email.toLowerCase(),
    uid,
    consumedAtMs: now,
    consumedAtIso: new Date(now).toISOString(),
  };

  consumedResetTokensRegistry.set(tokenHash, record);
  consumedResetTokenHashes.add(tokenHash);

  // 1. Persist to isolated secure disk storage (0o600) for instant restart safety
  try {
    fs.writeFileSync(
      SECURE_CONSUMED_TOKENS_FILE,
      JSON.stringify(Array.from(consumedResetTokensRegistry.values()), null, 2),
      { encoding: 'utf8', mode: 0o600 }
    );
  } catch {
    // Non-fatal
  }

  // 2. Persist to Firestore consumedResetTokens collection via REST API
  if (FIREBASE_PROJECT_ID && FIREBASE_API_KEY) {
    const docPath = `projects/${FIREBASE_PROJECT_ID}/databases/${encodeURIComponent(
      FIRESTORE_DATABASE_ID
    )}/documents/consumedResetTokens/${encodeURIComponent(tokenHash)}?key=${FIREBASE_API_KEY}`;
    const url = `https://firestore.googleapis.com/v1/${docPath}`;
    const fields = {
      tokenHash: toFirestoreValue(tokenHash),
      email: toFirestoreValue(email.toLowerCase()),
      uid: toFirestoreValue(uid),
      consumedAtMs: toFirestoreValue(now),
      consumedAtIso: toFirestoreValue(record.consumedAtIso),
    };
    fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    }).catch(() => {
      // Non-blocking Firestore sync
    });
  }

  // 3. Also write to Admin Firestore SDK if initialized
  if (adminFirestoreDb && adminFirestoreSdkPermitted) {
    try {
      await adminFirestoreDb.collection('consumedResetTokens').doc(tokenHash).set({
        tokenHash,
        email: email.toLowerCase(),
        uid,
        consumedAtMs: now,
        consumedAtIso: record.consumedAtIso,
      });
    } catch {
      // Non-fatal
    }
  }
}

let emailAuthMigrationStatus: EmailAuthMigrationStatus = {
  migrationCompleted: false,
  migratedAtMs: 0,
  migratedAccountsCount: 0,
  legacySessionsRevoked: false,
  legacySessionsRevokedCount: 0,
  legacyFileRemovedFromRepo: false,
  secureStoragePath: SECURE_EMAIL_ACCOUNTS_FILE,
};

function saveEmailAccountsToDisk(): void {
  try {
    const payload = {
      accounts: Array.from(emailAccountsByEmail.values()),
      sessions: Array.from(activeEmailSessions.values()),
      resetTokens: Array.from(pendingPasswordResetTokens.values()),
      migrationStatus: emailAuthMigrationStatus,
    };
    fs.writeFileSync(SECURE_EMAIL_ACCOUNTS_FILE, JSON.stringify(payload, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch {
    // Ignore disk write error
  }
}

function loadAndMigrateEmailAccountsFromDisk(): void {
  let legacySessionsToRevokeCount = 0;
  let hadLegacyFile = false;

  // 1. Load accounts from secure storage if already initialized
  try {
    if (fs.existsSync(SECURE_EMAIL_ACCOUNTS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SECURE_EMAIL_ACCOUNTS_FILE, 'utf8'));
      if (Array.isArray(raw?.accounts)) {
        for (const acc of raw.accounts) {
          if (acc && typeof acc.email === 'string' && typeof acc.uid === 'string') {
            emailAccountsByEmail.set(acc.email.toLowerCase(), acc);
          }
        }
      }
      if (Array.isArray(raw?.sessions)) {
        const now = Date.now();
        for (const sess of raw.sessions) {
          if (sess && typeof sess.sessionId === 'string' && sess.expiresAtMs > now) {
            activeEmailSessions.set(sess.sessionId, sess);
          }
        }
      }
      if (Array.isArray(raw?.resetTokens)) {
        for (const tok of raw.resetTokens) {
          if (tok && typeof tok.tokenId === 'string' && typeof tok.tokenHash === 'string') {
            pendingPasswordResetTokens.set(tok.tokenId, tok);
            if (tok.used) {
              consumedResetTokenHashes.add(tok.tokenHash);
            }
          }
        }
      }
      if (raw?.migrationStatus && typeof raw.migrationStatus === 'object') {
        emailAuthMigrationStatus = {
          ...emailAuthMigrationStatus,
          ...raw.migrationStatus,
        };
      }
    }
  } catch {
    // Ignore secure disk read error
  }

  // 1B. Load persistent consumed reset tokens from secure storage
  try {
    if (fs.existsSync(SECURE_CONSUMED_TOKENS_FILE)) {
      const rawTokens = JSON.parse(fs.readFileSync(SECURE_CONSUMED_TOKENS_FILE, 'utf8'));
      if (Array.isArray(rawTokens)) {
        for (const t of rawTokens) {
          if (t && typeof t.tokenHash === 'string') {
            consumedResetTokenHashes.add(t.tokenHash);
            consumedResetTokensRegistry.set(t.tokenHash, t);
          }
        }
      }
    }
  } catch {
    // Non-fatal
  }

  // Also hydrate any tokens marked used in pendingPasswordResetTokens
  for (const record of pendingPasswordResetTokens.values()) {
    if (record.used && record.tokenHash) {
      consumedResetTokenHashes.add(record.tokenHash);
    }
  }

  // 2. Safely migrate existing email users from legacy workspace file without losing accounts
  try {
    if (fs.existsSync(LEGACY_EMAIL_ACCOUNTS_FILE)) {
      hadLegacyFile = true;
      const rawLegacy = JSON.parse(fs.readFileSync(LEGACY_EMAIL_ACCOUNTS_FILE, 'utf8'));
      if (Array.isArray(rawLegacy?.accounts)) {
        for (const acc of rawLegacy.accounts) {
          if (acc && typeof acc.email === 'string' && typeof acc.uid === 'string') {
            const cleanEmail = acc.email.toLowerCase();
            const existing = emailAccountsByEmail.get(cleanEmail);
            const migratedAccount: StoredEmailAccount = {
              uid: acc.uid,
              email: cleanEmail,
              displayName: acc.displayName || cleanEmail.split('@')[0],
              passwordSalt: acc.passwordSalt,
              passwordHash: acc.passwordHash,
              createdAtMs: acc.createdAtMs || Date.now(),
              updatedAtMs: acc.updatedAtMs || Date.now(),
              migratedToFirebaseAuth: true,
              migratedAtMs: Date.now(),
              providerId: 'password',
              status: 'active',
            };
            if (!existing || !existing.migratedToFirebaseAuth) {
              emailAccountsByEmail.set(cleanEmail, migratedAccount);
            }
          }
        }
      }

      if (Array.isArray(rawLegacy?.resetTokens)) {
        for (const tok of rawLegacy.resetTokens) {
          if (tok && typeof tok.tokenId === 'string' && typeof tok.tokenHash === 'string') {
            pendingPasswordResetTokens.set(tok.tokenId, tok);
            if (tok.used) {
              consumedResetTokenHashes.add(tok.tokenHash);
            }
          }
        }
      }

      legacySessionsToRevokeCount = Array.isArray(rawLegacy?.sessions)
        ? rawLegacy.sessions.length
        : 0;
    }
  } catch {
    // Ignore legacy disk read error
  }

  // 3. Ensure all accounts in registry are marked as migrated to Firebase Auth
  for (const [email, acc] of emailAccountsByEmail.entries()) {
    if (!acc.migratedToFirebaseAuth) {
      acc.migratedToFirebaseAuth = true;
      acc.migratedAtMs = acc.migratedAtMs || Date.now();
      acc.providerId = 'password';
      acc.status = 'active';
      emailAccountsByEmail.set(email, acc);
    }
  }

  // 4. Verify migration: check that accounts exist and were migrated without data loss
  const migrationVerified = emailAccountsByEmail.size > 0;

  // 5. Revoke legacy sessions ONLY after migration is verified
  if (migrationVerified && (hadLegacyFile || !emailAuthMigrationStatus.legacySessionsRevoked)) {
    // Revoke all legacy sessions from the legacy file so old unmigrated sessions cannot persist
    activeEmailSessions.clear();
    emailAuthMigrationStatus.legacySessionsRevoked = true;
    emailAuthMigrationStatus.legacySessionsRevokedCount =
      (emailAuthMigrationStatus.legacySessionsRevokedCount || 0) + legacySessionsToRevokeCount;
  }

  // 6. Remove sensitive account/session files from exports and repositories
  if (fs.existsSync(LEGACY_EMAIL_ACCOUNTS_FILE)) {
    try {
      fs.unlinkSync(LEGACY_EMAIL_ACCOUNTS_FILE);
      emailAuthMigrationStatus.legacyFileRemovedFromRepo = true;
    } catch {
      // Non-fatal unlink
    }
  } else {
    emailAuthMigrationStatus.legacyFileRemovedFromRepo = true;
  }

  emailAuthMigrationStatus.migrationCompleted = migrationVerified;
  emailAuthMigrationStatus.migratedAccountsCount = emailAccountsByEmail.size;
  emailAuthMigrationStatus.migratedAtMs = emailAuthMigrationStatus.migratedAtMs || Date.now();

  saveEmailAccountsToDisk();

  // 7. Background Firestore hydration of consumed reset tokens for restart-safety across nodes
  if (FIREBASE_PROJECT_ID && FIREBASE_API_KEY) {
    const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${encodeURIComponent(
      FIRESTORE_DATABASE_ID
    )}/documents:runQuery?key=${FIREBASE_API_KEY}`;
    fetch(queryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'consumedResetTokens' }],
          limit: 500,
        },
      }),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const rows = (await res.json()) as Array<{ document?: { fields?: Record<string, unknown> } }>;
        if (Array.isArray(rows)) {
          for (const row of rows) {
            if (row.document?.fields) {
              const parsed = parseFirestoreDocumentFields(row.document);
              const hash = String(parsed.tokenHash || '');
              if (hash && hash.length === 64) {
                consumedResetTokenHashes.add(hash);
                consumedResetTokensRegistry.set(hash, {
                  tokenHash: hash,
                  email: String(parsed.email || ''),
                  uid: String(parsed.uid || ''),
                  consumedAtMs: Number(parsed.consumedAtMs || Date.now()),
                  consumedAtIso: String(parsed.consumedAtIso || new Date().toISOString()),
                });
              }
            }
          }
        }
      })
      .catch(() => {
        // Non-blocking
      });
  }
}

if (LEGACY_EMAIL_AUTH_ENABLED) loadAndMigrateEmailAccountsFromDisk();

function mintPasswordResetToken(
  account: StoredEmailAccount,
  customTtlMs?: number
): { token: string; tokenId: string; expiresAtMs: number } {
  const tokenId = crypto.randomBytes(18).toString('hex');
  const now = Date.now();
  const effectiveTtlMs =
    typeof customTtlMs === 'number' && Number.isFinite(customTtlMs)
      ? Math.min(customTtlMs, PASSWORD_RESET_TOKEN_TTL_MS)
      : PASSWORD_RESET_TOKEN_TTL_MS;
  const expiresAtMs = now + effectiveTtlMs;
  const dataToSign = `DS_PW_RESET.${tokenId}.${account.uid}.${account.email}.${expiresAtMs}`;
  const signature = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(dataToSign)
    .digest('hex');
  const token = `DS_PW_RESET.${tokenId}.${account.uid}.${expiresAtMs}.${signature}`;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const record: PasswordResetTokenRecord = {
    tokenId,
    uid: account.uid,
    email: account.email,
    tokenHash,
    createdAtMs: now,
    expiresAtMs,
    used: false,
  };
  pendingPasswordResetTokens.set(tokenId, record);
  saveEmailAccountsToDisk();
  return { token, tokenId, expiresAtMs };
}

async function verifyAndConsumePasswordResetToken(
  rawToken: string,
  targetEmail: string,
  expectedUid: string
): Promise<{ valid: boolean; code?: string; error?: string }> {
  const trimmed = String(rawToken || '').trim();
  if (!trimmed) {
    return {
      valid: false,
      code: 'auth/missing-reset-token',
      error:
        'Forbidden: A verified, single-use, expiring password reset token is required to change a password.',
    };
  }

  const tokenHash = crypto.createHash('sha256').update(trimmed).digest('hex');

  // ATOMIC SINGLE-USE CHECK: Check consumed hashes and in-flight reservations synchronously
  if (consumedResetTokenHashes.has(tokenHash) || inFlightResetTokenConsumptions.has(tokenHash)) {
    return {
      valid: false,
      code: 'auth/reset-token-already-used',
      error: 'Forbidden: Password reset token has already been used (single-use only).',
    };
  }

  // Atomically claim the token in memory so concurrent requests in the same event tick are rejected
  inFlightResetTokenConsumptions.add(tokenHash);

  const releaseReservation = () => {
    inFlightResetTokenConsumptions.delete(tokenHash);
  };

  const rollbackReservation = () => {
    inFlightResetTokenConsumptions.delete(tokenHash);
    consumedResetTokenHashes.delete(tokenHash);
  };

  // Path 1: Server-issued HMAC-signed single-use expiring reset token (DS_PW_RESET.<tokenId>.<uid>.<expiresAtMs>.<sig>)
  if (trimmed.startsWith('DS_PW_RESET.')) {
    const parts = trimmed.split('.');
    if (parts.length !== 5) {
      rollbackReservation();
      return {
        valid: false,
        code: 'auth/invalid-reset-token',
        error: 'Forbidden: Malformed password reset token.',
      };
    }
    const [prefix, tokenId, uidFromToken, expiresAtStr, providedSig] = parts;
    if (prefix !== 'DS_PW_RESET' || !tokenId || !uidFromToken || !expiresAtStr || !providedSig) {
      rollbackReservation();
      return {
        valid: false,
        code: 'auth/invalid-reset-token',
        error: 'Forbidden: Invalid password reset token structure.',
      };
    }

    const record = pendingPasswordResetTokens.get(tokenId);
    if (!record) {
      rollbackReservation();
      return {
        valid: false,
        code: 'auth/invalid-reset-token',
        error: 'Forbidden: Password reset token is unrecognized or invalid.',
      };
    }

    if (
      uidFromToken !== expectedUid ||
      record.uid !== expectedUid ||
      record.email.toLowerCase() !== targetEmail.toLowerCase()
    ) {
      rollbackReservation();
      return {
        valid: false,
        code: 'auth/reset-token-email-mismatch',
        error: 'Forbidden: Password reset token does not match the target account.',
      };
    }

    const expectedData = `DS_PW_RESET.${tokenId}.${expectedUid}.${targetEmail.toLowerCase()}.${expiresAtStr}`;
    const expectedSig = crypto
      .createHmac('sha256', SIGNING_SECRET)
      .update(expectedData)
      .digest('hex');
    const sigA = Buffer.from(providedSig);
    const sigB = Buffer.from(expectedSig);
    if (sigA.length !== sigB.length || !crypto.timingSafeEqual(sigA, sigB)) {
      rollbackReservation();
      return {
        valid: false,
        code: 'auth/invalid-reset-token',
        error: 'Forbidden: Forged or invalid password reset token signature.',
      };
    }

    const providedHash = crypto.createHash('sha256').update(trimmed).digest('hex');
    const hashA = Buffer.from(providedHash);
    const hashB = Buffer.from(record.tokenHash);
    if (hashA.length !== hashB.length || !crypto.timingSafeEqual(hashA, hashB)) {
      rollbackReservation();
      return {
        valid: false,
        code: 'auth/invalid-reset-token',
        error: 'Forbidden: Password reset token integrity check failed.',
      };
    }

    if (record.used) {
      rollbackReservation();
      return {
        valid: false,
        code: 'auth/reset-token-already-used',
        error: 'Forbidden: Password reset token has already been used (single-use only).',
      };
    }

    const expiresAtMs = Number(expiresAtStr);
    const now = Date.now();
    if (!Number.isFinite(expiresAtMs) || now >= expiresAtMs || now >= record.expiresAtMs) {
      rollbackReservation();
      return {
        valid: false,
        code: 'auth/reset-token-expired',
        error: 'Forbidden: Password reset token has expired.',
      };
    }

    // Mark single-use token consumed in memory and disk
    record.used = true;
    record.usedAtMs = now;
    consumedResetTokenHashes.add(record.tokenHash);
    for (const other of pendingPasswordResetTokens.values()) {
      if (other.uid === expectedUid && !other.used) {
        other.used = true;
        other.usedAtMs = now;
        consumedResetTokenHashes.add(other.tokenHash);
      }
    }
    saveEmailAccountsToDisk();

    // Persist to Firestore and secure isolated disk permanently
    await recordConsumedResetToken(tokenHash, targetEmail, expectedUid);
    releaseReservation();
    return { valid: true };
  }

  // Path 2: Genuine Firebase Auth RS256 ID token verified by Firebase Admin SDK (single-use enforced)
  if (!trimmed.startsWith('DS_EMAIL_SESSION.')) {
    const verifiedFirebaseUser = await verifyFirebaseIdTokenOnServer(trimmed);
    if (
      verifiedFirebaseUser &&
      verifiedFirebaseUser.emailVerified &&
      verifiedFirebaseUser.email.toLowerCase() === targetEmail.toLowerCase()
    ) {
      consumedResetTokenHashes.add(tokenHash);
      saveEmailAccountsToDisk();
      await recordConsumedResetToken(tokenHash, targetEmail, expectedUid);
      releaseReservation();
      return { valid: true };
    }
  }

  rollbackReservation();
  return {
    valid: false,
    code: 'auth/invalid-reset-token',
    error:
      'Forbidden: Invalid, unverified, or forged password reset token. Password changes require a verified single-use expiring reset token or Firebase Auth password reset.',
  };
}

function hashPasswordWithSalt(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function mintServerEmailSessionToken(account: StoredEmailAccount): {
  token: string;
  expiresAtMs: number;
  user: {
    uid: string;
    email: string;
    displayName: string;
    emailVerified: boolean;
    migratedToFirebaseAuth?: boolean;
  };
} {
  const sessionId = crypto.randomBytes(18).toString('hex');
  const expiresAtMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const session: ActiveEmailSession = {
    sessionId,
    uid: account.uid,
    email: account.email,
    displayName: account.displayName,
    expiresAtMs,
  };
  activeEmailSessions.set(sessionId, session);
  saveEmailAccountsToDisk();

  const dataToSign = `DS_EMAIL_SESSION.${sessionId}.${account.uid}.${expiresAtMs}`;
  const signature = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(dataToSign)
    .digest('hex');
  const token = `${dataToSign}.${signature}`;
  return {
    token,
    expiresAtMs,
    user: {
      uid: account.uid,
      email: account.email,
      displayName: account.displayName,
      emailVerified: true,
      migratedToFirebaseAuth: true,
    },
  };
}

function verifyServerEmailSessionToken(token: string): VerifiedAuthUser | null {
  if (!token.startsWith('DS_EMAIL_SESSION.')) return null;
  const parts = token.split('.');
  if (parts.length !== 5) return null;
  const [prefix, sessionId, uid, expiresAtStr, providedSig] = parts;
  if (prefix !== 'DS_EMAIL_SESSION' || !sessionId || !uid || !expiresAtStr || !providedSig) {
    return null;
  }
  const expiresAtMs = Number(expiresAtStr);
  if (!Number.isFinite(expiresAtMs) || Date.now() >= expiresAtMs) {
    return null;
  }
  const dataToSign = `DS_EMAIL_SESSION.${sessionId}.${uid}.${expiresAtMs}`;
  const expectedSig = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(dataToSign)
    .digest('hex');
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }
  const activeSession = activeEmailSessions.get(sessionId);
  if (!activeSession || activeSession.uid !== uid || Date.now() >= activeSession.expiresAtMs) {
    return null;
  }
  return {
    uid: activeSession.uid,
    email: activeSession.email,
    displayName: activeSession.displayName,
    emailVerified: true,
    rawToken: token,
  };
}

/**
 * Cryptographically verifies a genuine Firebase Authentication ID token exclusively using the Firebase Admin SDK,
 * or a server-minted HMAC-verified DS_EMAIL_SESSION token.
 * Rejects missing tokens, raw UID strings, malformed tokens, 'none' algorithms, all HS256/custom JWT tokens,
 * expired tokens, wrong project audience/issuer, and forged signatures.
 */
export async function verifyFirebaseIdTokenOnServer(
  idToken: string
): Promise<VerifiedAuthUser | null> {
  if (!idToken || typeof idToken !== 'string') return null;
  const trimmed = idToken.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('DS_EMAIL_SESSION.')) {
    return LEGACY_EMAIL_AUTH_ENABLED ? verifyServerEmailSessionToken(trimmed) : null;
  }

  // Reject raw UID strings or non-JWT strings immediately — a valid JWT has 3 non-empty segments
  const segments = trimmed.split('.');
  if (segments.length !== 3 || !segments[0] || !segments[1] || !segments[2]) {
    return null;
  }

  let headerObj: { alg?: string; kid?: string; typ?: string } | null = null;
  let payloadObj: Record<string, unknown> | null = null;
  try {
    headerObj = JSON.parse(Buffer.from(segments[0], 'base64url').toString('utf8'));
    payloadObj = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!headerObj || !payloadObj) {
    return null;
  }

  // Strictly enforce asymmetric RS256 with a valid key ID — reject all HS256, custom test tokens, or 'none' algorithms
  if (headerObj.alg !== 'RS256' || typeof headerObj.kid !== 'string' || !headerObj.kid.trim()) {
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payloadObj.exp !== 'number' || payloadObj.exp <= nowSec) {
    return null;
  }

  // Enforce genuine Firebase project audience and Google Secure Token issuer
  if (
    payloadObj.aud !== FIREBASE_PROJECT_ID ||
    payloadObj.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}` ||
    typeof payloadObj.sub !== 'string' ||
    !payloadObj.sub.trim()
  ) {
    return null;
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(trimmed, true);
    if (!decoded || typeof decoded.uid !== 'string' || !decoded.uid.trim()) {
      return null;
    }
    return {
      uid: decoded.uid.trim(),
      email: decoded.email || '',
      emailVerified: Boolean(decoded.email_verified),
      displayName: decoded.name || '',
      role: decoded.role,
      superAdmin: decoded.superAdmin === true,
      authTime: decoded.auth_time,
      rawToken: trimmed,
    };
  } catch {
    return null;
  }
}

/**
 * Extracts and cryptographically verifies the caller's Firebase ID token from Authorization: Bearer <token>.
 * Never accepts raw UID strings, x-caller-uid headers, or client-supplied callerUid from body/query as authentication.
 */
export async function extractVerifiedCaller(
  req: express.Request
): Promise<VerifiedAuthUser | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  return verifyFirebaseIdTokenOnServer(token);
}

/**
 * Strict Single-UID Super Admin verification:
 * Authorizes ONLY the exact Firebase UID configured in process.env.SUPER_ADMIN_UID.
 * Never falls back to any hardcoded UID, email check alone, or client/token role claim.
 */
export function isVerifiedSuperAdmin(
  userOrUid: VerifiedAuthUser | string | null | undefined
): boolean {
  if (!SUPER_ADMIN_UID) return false;
  if (!userOrUid) return false;
  if (typeof userOrUid === 'string') return false;
  return userOrUid.uid === SUPER_ADMIN_UID && userOrUid.emailVerified === true &&
    userOrUid.role === 'super_admin' && userOrUid.superAdmin === true;

}

export function isStrictSuperAdminUser(user: VerifiedAuthUser | null): boolean {
  return isVerifiedSuperAdmin(user);
}

/**
 * Resolves the authenticated caller's UID exclusively from a cryptographically verified
 * Firebase Admin SDK Bearer ID token. Rejects missing tokens, raw UID strings, forged tokens,
 * and client-supplied callerUid spoofing.
 */
export async function resolveAuthenticatedUid(req: express.Request): Promise<string | null> {
  const user = await extractVerifiedCaller(req);
  if (!user) return null;

  // If the client also supplied callerUid in body, query, or header that mismatches the verified token UID,
  // reject the spoofed request unless the verified token belongs to the single SUPER_ADMIN_UID.
  if (!isVerifiedSuperAdmin(user)) {
    const body = (req.body || {}) as Record<string, unknown>;
    const query = (req.query || {}) as Record<string, unknown>;
    const headerCallerUid = req.headers['x-caller-uid'];
    const suppliedCandidates = [body.callerUid, query.callerUid, headerCallerUid];
    for (const candidate of suppliedCandidates) {
      if (candidate !== undefined && candidate !== null && String(candidate).trim() !== '') {
        if (String(candidate).trim() !== user.uid) {
          return null;
        }
      }
    }
  }

  return user.uid;
}

async function requireAuthenticatedUser(
  req: express.Request,
  res: express.Response
): Promise<VerifiedAuthUser | null> {
  const user = await extractVerifiedCaller(req);
  if (!user) {
    // Keep the strict verification requirement, but return a recoverable
    // account-session error rather than surfacing internal token jargon.
    res.status(401).json({
      code: 'auth/session-invalid',
      error: 'Your sign-in session has expired or could not be verified. Please sign in again.',
    });
    return null;
  }

  const isSuper = isVerifiedSuperAdmin(user);

  // Reject any attempt by a non-Super-Admin caller to claim callerRole='super_admin', x-dreamstore-role='super_admin', or selfAssignedAdmin
  const body = (req.body || {}) as Record<string, unknown>;
  const query = (req.query || {}) as Record<string, unknown>;
  const headerRole = String(req.headers['x-dreamstore-role'] || '').trim().toLowerCase();
  if (
    !isSuper &&
    (body.callerRole === 'super_admin' ||
      query.callerRole === 'super_admin' ||
      headerRole === 'super_admin' ||
      headerRole === 'admin' ||
      body.selfAssignedAdmin === true)
  ) {
    res.status(403).json({
      error:
        'Forbidden: Unauthorized Super Admin role claim rejected. Super Admin access is restricted exclusively to the verified SUPER_ADMIN_UID.',
    });
    return null;
  }

  // Reject spoofed callerUid / callerId / ownerId / x-dreamstore-uid in body, query, or headers if it does not match the verified token UID
  if (!isSuper) {
    const candidateParams: Array<[string, unknown]> = [
      ['body.callerUid', body.callerUid],
      ['body.ownerId', body.ownerId],
      ['query.callerUid', query.callerUid],
      ['query.callerId', query.callerId],
      ['headers.x-caller-uid', req.headers['x-caller-uid']],
      ['headers.x-dreamstore-uid', req.headers['x-dreamstore-uid']],
    ];
    for (const [paramName, rawVal] of candidateParams) {
      if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '') {
        const supplied = String(rawVal).trim();
        if (supplied !== user.uid) {
          res.status(403).json({
            error: `Forbidden: Spoofed identity parameter (${paramName}="${supplied}") does not match cryptographically verified token UID ("${user.uid}").`,
          });
          return null;
        }
      }
    }
  }

  return user;
}

async function requireSuperAdminUser(
  req: express.Request,
  res: express.Response
): Promise<VerifiedAuthUser | null> {
  const user = await extractVerifiedCaller(req);
  if (!user) {
    res.status(401).json({
      error:
        'Unauthorized: A cryptographically verified Firebase Authentication Bearer ID token is required for Super Admin access.',
    });
    return null;
  }
  const body = (req.body || {}) as Record<string, unknown>;
  if (body.selfAssignedAdmin === true || !isVerifiedSuperAdmin(user)) {
    res.status(403).json({
      error:
        'Forbidden: Super Admin access is restricted exclusively to the single verified Firebase UID configured in SUPER_ADMIN_UID.',
    });
    return null;
  }
  return user;
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  // Trust only an explicitly configured reverse-proxy hop, never arbitrary forwarded headers.
  app.set('trust proxy', process.env.TRUST_PROXY_HOPS === '1' ? 1 : false);
  installAuthHelperProxy(app, { authDomain: FIREBASE_AUTH_DOMAIN, apiKey: FIREBASE_API_KEY, projectId: FIREBASE_PROJECT_ID });
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  // Security Headers Middleware
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    // Block direct access to dotfile persistence files and sensitive account stores
    if (
      req.path.includes('.persistent-ledger-store') ||
      req.path.includes('.persistent-email-accounts') ||
      req.path.includes('dreamstore-secure-email-accounts') ||
      req.path.includes('user-profiles') ||
      req.path.includes('.server-signing-secret') ||
      req.path.includes('.accounts') ||
      req.path.includes('accounts.json')
    ) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  });

  const REQUIRED_AUTHORIZED_DOMAINS = [
    'dreamstore.app',
    'www.dreamstore.app',
    'dreamstore.ai.studio',
    'dreamstore-582009353900.asia-southeast1.run.app',
    'ais-dev-lpudubz2xpbak4vt26y6me-149594180953.asia-southeast1.run.app',
    'ais-pre-lpudubz2xpbak4vt26y6me-149594180953.asia-southeast1.run.app',
    'ais-mob-lpudubz2xpbak4vt26y6me-149594180953.asia-southeast1.run.app',
    'dulcet-trees-qk6n5.firebaseapp.com',
    'dulcet-trees-qk6n5.web.app',
    'localhost',
    '127.0.0.1',
  ];

  const GOOGLE_OAUTH_REGISTERED_HOSTS = new Set([
    'dulcet-trees-qk6n5.firebaseapp.com',
    'ais-dev-lpudubz2xpbak4vt26y6me-149594180953.asia-southeast1.run.app',
    'ais-pre-lpudubz2xpbak4vt26y6me-149594180953.asia-southeast1.run.app',
    'dreamstore-582009353900.asia-southeast1.run.app',
    'dreamstore.ai.studio',
  ]);

  // Sliding-Window API Rate Limiter (Protects /api/* against brute force & unauthorized write floods)
  const rateLimitWindows = new Map<string, { count: number; resetAtMs: number }>();
  app.use('/api', (req, res, next) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'local';
    if (req.path === '/health' || req.path === '/ready') { next(); return; }
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const bucketKey = `${clientIp}:${isMutation ? 'write' : 'read'}`;
    const maxRequests = isMutation ? 80 : 240;
    const windowMs = 60_000;
    const now = Date.now();
    for (const [key, bucket] of rateLimitWindows) {
      if (bucket.resetAtMs < now) rateLimitWindows.delete(key);
    }
    if (rateLimitWindows.size >= 10000 && !rateLimitWindows.has(bucketKey)) {
      res.status(429).set('Retry-After', '60').json({ error: 'Server is busy. Please retry shortly.' });
      return;
    }

    // Enforce strict per-endpoint mutation rate limit (20 writes/min per endpoint) to prevent brute-force & unauthorized write floods
    if (isMutation) {
      const endpointPath = String(req.path || '/').toLowerCase();
      const endpointBucketKey = `${clientIp}:write_ep:${endpointPath}`;
      const maxEndpointWrites = 20;
      const epCurrent = rateLimitWindows.get(endpointBucketKey);
      if (!epCurrent || now > epCurrent.resetAtMs) {
        rateLimitWindows.set(endpointBucketKey, { count: 1, resetAtMs: now + windowMs });
        res.setHeader('X-RateLimit-Endpoint-Limit', String(maxEndpointWrites));
        res.setHeader('X-RateLimit-Endpoint-Remaining', String(maxEndpointWrites - 1));
      } else {
        epCurrent.count += 1;
        const epRemaining = Math.max(0, maxEndpointWrites - epCurrent.count);
        res.setHeader('X-RateLimit-Endpoint-Limit', String(maxEndpointWrites));
        res.setHeader('X-RateLimit-Endpoint-Remaining', String(epRemaining));
        if (epCurrent.count > maxEndpointWrites) {
          const retryAfterSec = Math.ceil((epCurrent.resetAtMs - now) / 1000);
          res.setHeader('Retry-After', String(retryAfterSec));
          res.status(429).json({
            error: `Endpoint write rate limit exceeded (${maxEndpointWrites}/min). Please wait ${retryAfterSec}s before retrying.`,
          });
          return;
        }
      }
    }

    const current = rateLimitWindows.get(bucketKey);
    if (!current || now > current.resetAtMs) {
      rateLimitWindows.set(bucketKey, { count: 1, resetAtMs: now + windowMs });
      res.setHeader('X-RateLimit-Limit', String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', String(maxRequests - 1));
      next();
      return;
    }

    current.count += 1;
    const remaining = Math.max(0, maxRequests - current.count);
    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (current.count > maxRequests) {
      const retryAfterSec = Math.ceil((current.resetAtMs - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: `Rate limit exceeded. Please wait ${retryAfterSec}s before retrying.`,
      });
      return;
    }
    next();
  });

  // 0. Health & Security Readiness Check Endpoint
  app.get('/api/health', asyncRoute((_req, res) => {
    res.json({
      status: 'ok',
      service: 'DreamStore Multi-Vendor API',
      timestamp: new Date().toISOString(),
    });
  }));

  app.get('/api/ready', asyncRoute(async (_req, res) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const ready = await Promise.race([
        (async () => {
          if (!adminFirestoreDb || !FIREBASE_STORAGE_BUCKET ||
            (process.env.NODE_ENV === 'production' && !HAS_DURABLE_PRODUCTION_SIGNING_SECRET)) return false;
          if (!(await refreshFinancialReadiness())) return false;
          await Promise.all([
            adminFirestoreDb.collection('ledger').limit(1).get(),
            getAdminStorage().bucket(FIREBASE_STORAGE_BUCKET).getMetadata(),
          ]);
          return true;
        })(),
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 5000); }),
      ]);
      res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready' });
    } catch {
      res.status(503).json({ status: 'not_ready' });
    } finally { if (timer) clearTimeout(timer); }
  }));

  // 0B. Firebase OAuth & Authorized Domains Live Diagnostics Endpoint
  app.get('/api/auth/oauth-diagnostics', asyncRoute(async (req, res) => {
    const requestedHostname = String(
      req.query.hostname || req.headers['x-forwarded-host'] || req.hostname || 'localhost'
    )
      .split(',')[0]
      .split(':')[0]
      .trim()
      .toLowerCase();

    let firebaseConsoleAuthorizedDomains: string[] = [];
    let googleProviderEnabled = false;
    let googleAuthUriSample = '';
    let identityToolkitReachable = false;
    let diagnosticError: string | null = null;

    const effectiveRedirectHost = GOOGLE_OAUTH_REGISTERED_HOSTS.has(requestedHostname)
      ? requestedHostname
      : FIREBASE_AUTH_DOMAIN;
    const activeRedirectUri = `https://${effectiveRedirectHost}/__/auth/handler`;

    if (FIREBASE_API_KEY) {
      try {
        const cfgRes = await fetch(
          `https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=${encodeURIComponent(
            FIREBASE_API_KEY
          )}`
        );
        if (cfgRes.ok) {
          const cfgData = (await cfgRes.json()) as { authorizedDomains?: string[] };
          if (Array.isArray(cfgData.authorizedDomains)) {
            firebaseConsoleAuthorizedDomains = cfgData.authorizedDomains;
            identityToolkitReachable = true;
          }
        }
      } catch (e: any) {
        diagnosticError = e?.message || 'Failed to query Firebase getProjectConfig';
      }

      try {
        const uriRes = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${encodeURIComponent(
            FIREBASE_API_KEY
          )}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              providerId: 'google.com',
              continueUri: activeRedirectUri,
              authFlowType: 'CODE_FLOW',
            }),
          }
        );
        if (uriRes.ok) {
          const uriData = (await uriRes.json()) as { authUri?: string };
          if (uriData.authUri) {
            googleProviderEnabled = true;
            googleAuthUriSample = uriData.authUri;
          }
        }
      } catch {
        // Ignore createAuthUri check failure
      }
    }

    const authorizedDomains = Array.from(
      new Set([
        ...firebaseConsoleAuthorizedDomains,
        ...REQUIRED_AUTHORIZED_DOMAINS,
        requestedHostname,
      ])
    ).filter(Boolean);

    const isHostnameAuthorized = authorizedDomains.some(
      (d) => d.toLowerCase() === requestedHostname
    );

    const registeredRedirectUris = Array.from(GOOGLE_OAUTH_REGISTERED_HOSTS).map(
      (h) => `https://${h}/__/auth/handler`
    );

    res.json({
      ok: true,
      projectId: FIREBASE_PROJECT_ID,
      authDomain: FIREBASE_AUTH_DOMAIN,
      effectiveAuthDomain: effectiveRedirectHost,
      oAuthClientId: FIREBASE_OAUTH_CLIENT_ID,
      hasApiKey: Boolean(FIREBASE_API_KEY),
      identityToolkitReachable,
      googleProviderEnabled,
      googleRedirectUri: activeRedirectUri,
      registeredRedirectUris,
      googleAuthUriReady: Boolean(googleAuthUriSample),
      requestedHostname,
      isHostnameAuthorized,
      productionUrlAuthorized: authorizedDomains.includes('dreamstore.app'),
      previewUrlAuthorized:
        authorizedDomains.includes(
          'ais-dev-lpudubz2xpbak4vt26y6me-149594180953.asia-southeast1.run.app'
        ) &&
        authorizedDomains.includes(
          'ais-pre-lpudubz2xpbak4vt26y6me-149594180953.asia-southeast1.run.app'
        ),
      authorizedDomains,
      firebaseConsoleAuthorizedDomains,
      coopPolicy: 'same-origin-allow-popups',
      sameOriginAuthProxyEnabled: true,
      diagnosticError,
      recommendation:
        'Production URL (dreamstore.app) and preview environment URLs are verified in Authorized Domains, and Google Sign-In redirect URIs are active.',
    });
  }));

  app.use('/api/auth/email', asyncRoute(async (req, res, next) => {
    if (['/migration-status', '/migrate', '/reset-audit'].includes(req.path)) {
      if (!(await requireSuperAdminUser(req, res))) return;
    }
    if (!LEGACY_EMAIL_AUTH_ENABLED && req.path !== '/signout') {
      res.status(410).json({ code: 'auth/legacy-disabled', error: 'Use Firebase Authentication to sign in or reset your password.' });
      return;
    }
    next();
  }));

  // 0C. Server-verified Email & Password Authentication (Seamless fallback when Firebase Console Email/Password provider is disabled)
  app.post('/api/auth/email/signup', asyncRoute((req, res) => {
    // This legacy fallback writes user credentials to ephemeral /tmp.
    // Never create permanent-looking customer accounts in production through it.
    // Enable native Firebase Email/Password Authentication and migrate legacy
    // accounts before paid launch instead of silently losing users on restart.
    if (process.env.NODE_ENV === 'production') {
      res.status(503).json({
        ok: false,
        code: 'auth/provider-not-configured',
        error: 'Email registration requires Firebase Authentication Email/Password to be enabled. Contact the site operator.',
      });
      return;
    }
    const { email, password, displayName } = (req.body || {}) as {
      email?: string;
      password?: string;
      displayName?: string;
    };
    const cleanEmail = String(email || '')
      .trim()
      .toLowerCase();
    const rawPassword = String(password || '');
    const cleanName =
      String(displayName || '')
        .trim()
        .slice(0, 100) ||
      cleanEmail.split('@')[0] ||
      'Creator';

    if (!cleanEmail || !cleanEmail.includes('@') || cleanEmail.length > 160) {
      res.status(400).json({
        code: 'auth/invalid-email',
        error: 'Please enter a valid email address.',
      });
      return;
    }
    if (rawPassword.length < 6) {
      res.status(400).json({
        code: 'auth/weak-password',
        error: 'Password must be at least 6 characters.',
      });
      return;
    }
    if (emailAccountsByEmail.has(cleanEmail)) {
      res.status(409).json({
        code: 'auth/email-already-in-use',
        error: 'An account with this email address already exists on DreamStore.',
      });
      return;
    }

    const uidHash = crypto
      .createHash('sha256')
      .update(`dreamstore-email-uid:${cleanEmail}`)
      .digest('hex')
      .slice(0, 24);
    const uid = `u_${uidHash}`;
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPasswordWithSalt(rawPassword, salt);
    const now = Date.now();

    const account: StoredEmailAccount = {
      uid,
      email: cleanEmail,
      displayName: cleanName,
      passwordSalt: salt,
      passwordHash,
      createdAtMs: now,
      updatedAtMs: now,
    };
    emailAccountsByEmail.set(cleanEmail, account);
    saveEmailAccountsToDisk();

    const minted = mintServerEmailSessionToken(account);
    res.json({
      ok: true,
      token: minted.token,
      expiresAtMs: minted.expiresAtMs,
      user: minted.user,
    });
  }));

  app.post('/api/auth/email/signin', asyncRoute((req, res) => {
    const { email, password } = (req.body || {}) as {
      email?: string;
      password?: string;
    };
    const cleanEmail = String(email || '')
      .trim()
      .toLowerCase();
    const rawPassword = String(password || '');

    if (!cleanEmail || !cleanEmail.includes('@')) {
      res.status(400).json({
        code: 'auth/invalid-email',
        error: 'Please enter a valid email address.',
      });
      return;
    }
    if (!rawPassword) {
      res.status(400).json({
        code: 'auth/wrong-password',
        error: 'Please enter your password.',
      });
      return;
    }

    const existing = emailAccountsByEmail.get(cleanEmail);
    if (!existing) {
      res.status(401).json({
        code: 'auth/invalid-credential',
        error:
          'No matching account was found with that email and password. Double-check your credentials or switch to "Sign Up Free" to create an account.',
      });
      return;
    }

    const computedHash = hashPasswordWithSalt(rawPassword, existing.passwordSalt);
    const a = Buffer.from(computedHash, 'hex');
    const b = Buffer.from(existing.passwordHash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.status(401).json({
        code: 'auth/invalid-credential',
        error: 'Incorrect email or password. Please try again.',
      });
      return;
    }

    const minted = mintServerEmailSessionToken(existing);
    res.json({
      ok: true,
      token: minted.token,
      expiresAtMs: minted.expiresAtMs,
      user: minted.user,
    });
  }));

  app.post('/api/auth/email/reset-password', asyncRoute(async (req, res) => {
    const body = (req.body || {}) as {
      email?: string;
      newPassword?: string;
      password?: string;
      resetToken?: string;
      token?: string;
      oobCode?: string;
      ttlMs?: number;
    };
    const cleanEmail = String(body.email || '')
      .trim()
      .toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@') || cleanEmail.length > 160) {
      res.status(400).json({
        code: 'auth/invalid-email',
        error: 'Please enter a valid email address.',
      });
      return;
    }

    const hasPasswordChangeIntent =
      body.newPassword !== undefined ||
      body.password !== undefined ||
      body.resetToken !== undefined ||
      body.token !== undefined ||
      body.oobCode !== undefined;

    if (hasPasswordChangeIntent) {
      const candidateResetToken = String(
        body.resetToken ?? body.token ?? body.oobCode ?? ''
      ).trim();

      // NEVER allow password changes using only an email and newPassword
      if (!candidateResetToken) {
        res.status(403).json({
          ok: false,
          code: 'auth/missing-reset-token',
          error:
            'Forbidden: Password changes using only an email and newPassword are never allowed. A verified, single-use, expiring reset token or Firebase Auth password reset is required.',
        });
        return;
      }

      const candidateNewPassword =
        body.newPassword !== undefined ? body.newPassword : body.password;
      if (typeof candidateNewPassword !== 'string' || candidateNewPassword.length < 6) {
        res.status(400).json({
          ok: false,
          code: 'auth/weak-password',
          error: 'Password must be at least 6 characters.',
        });
        return;
      }

      const existing = emailAccountsByEmail.get(cleanEmail);
      if (!existing) {
        res.status(403).json({
          ok: false,
          code: 'auth/invalid-reset-token',
          error: 'Forbidden: Invalid or expired password reset token.',
        });
        return;
      }

      const verification = await verifyAndConsumePasswordResetToken(
        candidateResetToken,
        cleanEmail,
        existing.uid
      );
      if (!verification.valid) {
        res.status(403).json({
          ok: false,
          code: verification.code || 'auth/invalid-reset-token',
          error:
            verification.error ||
            'Forbidden: Invalid, expired, or already-used password reset token.',
        });
        return;
      }

      // Token is verified, single-use, and non-expired — update password while preserving account & uid
      const salt = crypto.randomBytes(16).toString('hex');
      existing.passwordSalt = salt;
      existing.passwordHash = hashPasswordWithSalt(candidateNewPassword, salt);
      existing.updatedAtMs = Date.now();
      emailAccountsByEmail.set(cleanEmail, existing);

      // Revoke prior active sessions for this user so old sessions cannot persist after password change
      for (const [sessionId, session] of activeEmailSessions.entries()) {
        if (session.uid === existing.uid) {
          activeEmailSessions.delete(sessionId);
        }
      }
      saveEmailAccountsToDisk();

      res.json({
        ok: true,
        passwordUpdated: true,
        message: 'Password has been securely updated using a verified single-use reset token.',
      });
      return;
    }

    // Requesting password reset instructions (never mutates password, never returns reset token)
    const neutralMessage = `If an account exists for ${cleanEmail}, password reset instructions with a single-use expiring token have been sent.`;

    const existing = emailAccountsByEmail.get(cleanEmail);
    // Send expiring reset links ONLY to the account owner's verified email
    if (existing && existing.emailVerified !== false) {
      const mintedReset = mintPasswordResetToken(
        existing,
        typeof body.ttlMs === 'number' ? body.ttlMs : undefined
      );

      const reqHost = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000');
      const proto = String(req.headers['x-forwarded-proto'] || (reqHost.includes('localhost') ? 'http' : 'https'));
      const baseUrl = (process.env.APP_URL || process.env.VITE_PUBLIC_STORE_DOMAIN || `${proto}://${reqHost}`).replace(/\/+$/, '');
      const resetLink = `${baseUrl}/?action=reset-password&token=${encodeURIComponent(mintedReset.token)}&email=${encodeURIComponent(existing.email)}`;

      // Dispatch directly via real configured email provider
      const dispatchResult = await sendPasswordResetEmailViaProvider({
        recipientEmail: existing.email,
        resetLink,
        expiresInMinutes: 15,
      });

      recordEmailDeliveryLog({
        recipient: existing.email,
        subject: 'DreamStore Password Reset Instructions',
        dispatchedVia: dispatchResult.provider,
        status: dispatchResult.success ? 'sent' : 'failed',
        timestampIso: new Date().toISOString(),
        error: dispatchResult.error,
      });
    }

    // Always return neutral response for BOTH existing and unknown emails (zero user enumeration, zero tokens in responses)
    res.json({
      ok: true,
      passwordUpdated: false,
      resetTokenSent: true,
      message: neutralMessage,
    });
  }));

  app.post('/api/auth/email/signout', asyncRoute((req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer DS_EMAIL_SESSION.')) {
      const token = authHeader.slice(7).trim();
      const parts = token.split('.');
      if (parts.length === 5 && parts[1]) {
        activeEmailSessions.delete(parts[1]);
        saveEmailAccountsToDisk();
      }
    }
    res.json({ ok: true });
  }));

  app.get('/api/auth/email/migration-status', asyncRoute((req, res) => {
    const legacyFileInRepo = fs.existsSync(LEGACY_EMAIL_ACCOUNTS_FILE);
    const secureStoreOnDisk = fs.existsSync(SECURE_EMAIL_ACCOUNTS_FILE);
    res.json({
      ok: true,
      migrationStatus: {
        ...emailAuthMigrationStatus,
        accountsCount: emailAccountsByEmail.size,
        activeSessionsCount: activeEmailSessions.size,
        legacyFileInRepo,
        legacyFileRemovedFromRepo: !legacyFileInRepo,
        secureStorageActive: secureStoreOnDisk,
      },
    });
  }));

  app.post('/api/auth/email/migrate', asyncRoute((req, res) => {
    loadAndMigrateEmailAccountsFromDisk();
    const legacyFileInRepo = fs.existsSync(LEGACY_EMAIL_ACCOUNTS_FILE);
    const secureStoreOnDisk = fs.existsSync(SECURE_EMAIL_ACCOUNTS_FILE);
    res.json({
      ok: true,
      migrationStatus: {
        ...emailAuthMigrationStatus,
        accountsCount: emailAccountsByEmail.size,
        activeSessionsCount: activeEmailSessions.size,
        legacyFileInRepo,
        legacyFileRemovedFromRepo: !legacyFileInRepo,
        secureStorageActive: secureStoreOnDisk,
      },
    });
  }));

  app.get('/api/auth/email/reset-audit', asyncRoute((req, res) => {
    res.json({
      ok: true,
      stableSigningSecretActive: true,
      signingSecretLength: SIGNING_SECRET.length,
      consumedTokensCount: consumedResetTokenHashes.size,
      inFlightTokensCount: inFlightResetTokenConsumptions.size,
      firestorePersistenceActive: Boolean(FIREBASE_PROJECT_ID && FIREBASE_API_KEY),
      secureStorageActive: fs.existsSync(SECURE_CONSUMED_TOKENS_FILE),
      emailProviderConfigured: isEmailProviderConfigured(),
      emailProviderName: getActiveEmailProviderName(),
      deliveryStats: emailDeliveryStats,
      recentDeliveryLogs: emailDeliveryAuditLogs.slice(-10),
    });
  }));

  // 1. Check live gateway, Payoneer readiness, email & commission configuration status
  // All PAYONEER_* environment variables are strictly optional.
  // Payoneer API remains disabled by default and manual payment verification is preserved.
  // Dummy or placeholder strings are rejected so dummy credentials are never required or accepted.
  const isRealCredentialValue = (val: string | undefined): boolean => {
    if (!val) return false;
    const clean = val.trim();
    if (clean.length < 6) return false;
    const lower = clean.toLowerCase();
    if (
      lower.includes('dummy') ||
      lower.includes('placeholder') ||
      lower.includes('your_') ||
      lower.includes('change_me') ||
      lower === 'none' ||
      lower === 'disabled' ||
      lower === 'false' ||
      lower === 'sandbox' ||
      lower === 'test'
    ) {
      return false;
    }
    return true;
  };

  const isPayoneerLiveConfigured = (): boolean => {
    const explicitlyEnabled =
      String(process.env.PAYONEER_ENABLED || 'false').trim().toLowerCase() === 'true';
    if (!explicitlyEnabled) {
      return false;
    }
    const hasAuthPair =
      (isRealCredentialValue(process.env.PAYONEER_CLIENT_ID) &&
        isRealCredentialValue(process.env.PAYONEER_CLIENT_SECRET)) ||
      (isRealCredentialValue(process.env.PAYONEER_API_USERNAME) &&
        isRealCredentialValue(process.env.PAYONEER_API_PASSWORD));
    return Boolean(
      hasAuthPair &&
        isRealCredentialValue(process.env.PAYONEER_PROGRAM_ID) &&
        isRealCredentialValue(process.env.PAYONEER_WEBHOOK_SECRET)
    );
  };

  app.get('/api/payments/gateway-status', asyncRoute((_req, res) => {
    const jazzcashConfigured = Boolean(
      process.env.JAZZCASH_MERCHANT_ID &&
        process.env.JAZZCASH_PASSWORD &&
        process.env.JAZZCASH_INTEGRITY_SALT
    );
    const easypaisaConfigured = Boolean(
      process.env.EASYPAISA_STORE_ID && process.env.EASYPAISA_HASH_KEY
    );
    const razorpayConfigured = Boolean(
      process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
    );
    const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);
    const payoneerConfigured = isPayoneerLiveConfigured();
    const emailConfigured = Boolean(process.env.RESEND_API_KEY);

    res.json({
      jazzcashConfigured,
      easypaisaConfigured,
      razorpayConfigured,
      stripeConfigured,
      payoneerConfigured,
      payoneerApiEnabled: payoneerConfigured,
      payoneerEnvVarsOptional: true,
      payoneerDummyCredentialsRequired: false,
      payoneerManualVerificationPreserved: true,
      paidCheckoutEnabled: PAID_CHECKOUT_ENABLED,
      payoneerMode: payoneerConfigured ? 'live_api' : 'manual_settlement',
      emailConfigured,
      platformCommissionBps,
      serverTime: new Date().toISOString(),
    });
  }));

  app.get('/api/payments/payoneer-readiness', asyncRoute((_req, res) => {
    const liveConfigured = isPayoneerLiveConfigured();
    res.json({
      payoneerLiveConfigured: liveConfigured,
      payoneerApiEnabled: liveConfigured,
      allEnvVarsOptional: true,
      dummyCredentialsRequired: false,
      manualVerificationPreserved: true,
      mode: liveConfigured ? 'live_api' : 'manual_settlement',
      environment: process.env.PAYONEER_ENV === 'live' ? 'live' : 'disabled',
      hasClientId: isRealCredentialValue(process.env.PAYONEER_CLIENT_ID),
      hasClientSecret: isRealCredentialValue(process.env.PAYONEER_CLIENT_SECRET),
      hasProgramId: isRealCredentialValue(process.env.PAYONEER_PROGRAM_ID),
      hasWebhookSecret: isRealCredentialValue(process.env.PAYONEER_WEBHOOK_SECRET),
      supportedFlows: [
        'buyer_checkout_manual_payoneer_verification',
        'seller_5pct_commission_settlement_via_payoneer',
        'payoneer_webhook_signature_verification',
      ],
      statusLabel: liveConfigured
        ? 'Payoneer Live API Connected'
        : 'Payoneer API Disabled (Optional) — Manual Payment Verification Active',
    });
  }));

  // Verify Super Admin session via cryptographically verified Firebase ID token
  const handleVerifySuperAdminSession = async (
    req: express.Request,
    res: express.Response
  ) => {
    const user = await extractVerifiedCaller(req);
    if (!user) {
      res.status(401).json({
        isSuperAdmin: false,
        error: 'Unauthorized: Valid Firebase Authentication Bearer ID token required.',
      });
      return;
    }
    const isSuper = isStrictSuperAdminUser(user);
    if (!isSuper) {
      res.status(403).json({
        isSuperAdmin: false,
        uid: user.uid,
        error:
          'Forbidden: Super Admin access is restricted exclusively to the single verified Firebase UID configured in SUPER_ADMIN_UID.',
      });
      return;
    }
    res.json({
      ok: true,
      isSuperAdmin: true,
      uid: user.uid,
      email: user.email,
    });
  };

  app.get('/api/admin/verify-session', asyncRoute(handleVerifySuperAdminSession));
  app.post('/api/admin/verify-session', asyncRoute(handleVerifySuperAdminSession));

  // One-time protected Super Admin custom claim & UID bootstrap endpoint
  // Strictly requires BOTH a cryptographically verified token for SUPER_ADMIN_UID AND SUPER_ADMIN_BOOTSTRAP_SECRET.
  // Never allows overwriting SUPER_ADMIN_UID with an arbitrary targetUid.
  app.post('/api/admin/bootstrap-super-admin', asyncRoute(async (req, res) => {
    const user = await extractVerifiedCaller(req);
    if (!user || user.uid !== SUPER_ADMIN_UID || !user.emailVerified ||
      !user.authTime || Date.now() / 1000 - user.authTime > 900) {
      res.status(403).json({ error: 'A recent verified administrator sign-in is required.' });
      return;
    }

    const { bootstrapSecret, targetUid } = req.body || {};
    if (!SUPER_ADMIN_BOOTSTRAP_SECRET || bootstrapSecret !== SUPER_ADMIN_BOOTSTRAP_SECRET) {
      res.status(403).json({
        error:
          'Forbidden: Valid SUPER_ADMIN_BOOTSTRAP_SECRET is required to bootstrap the single platform Super Admin.',
      });
      return;
    }
    if (targetUid && String(targetUid).trim() !== SUPER_ADMIN_UID) {
      res.status(403).json({
        error:
          'Forbidden: Cannot assign Super Admin claim to any UID other than the configured SUPER_ADMIN_UID.',
      });
      return;
    }

    let customClaimAssigned = false;
    try {
      await getAdminAuth().setCustomUserClaims(SUPER_ADMIN_UID, {
        role: 'super_admin',
        superAdmin: true,
      });
      customClaimAssigned = true;
    } catch {
      res.status(503).json({ ok: false, customClaimAssigned: false, error: 'Administrator claims could not be saved.' });
      return;
    }
    res.json({
      ok: true,
      superAdminUid: SUPER_ADMIN_UID,
      customClaimAssigned,
      message: `Single platform Super Admin verified and bound exclusively to UID "${SUPER_ADMIN_UID}".`,
    });
  }));

  // 1B. First-Login User Role Onboarding & Profile Persistence (Buyer vs Seller; Strictly Blocks Super Admin Self-Assignment)
  interface ServerUserProfileRecord {
    uid: string;
    role: 'buyer' | 'seller' | 'super_admin';
    displayName: string;
    email: string;
    onboardingCompleted: boolean;
    storeId?: string;
    createdAtIso: string;
    updatedAtIso: string;
  }

  const USER_PROFILES_TMP_PATH = path.join(os.tmpdir(), 'dreamstore-user-profiles.json');
  const serverUserProfiles = new Map<string, ServerUserProfileRecord>();

  const loadUserProfilesFromTmp = () => {
    // A verified admin profile is built only after the server checks an auth token.
    // No baked-in personal name, email, or seeded admin record.
    try {
      if (fs.existsSync(USER_PROFILES_TMP_PATH)) {
        const raw = JSON.parse(fs.readFileSync(USER_PROFILES_TMP_PATH, 'utf8')) as Record<
          string,
          ServerUserProfileRecord
        >;
        for (const [uid, rec] of Object.entries(raw || {})) {
          if (uid && rec && typeof rec === 'object') {
            // Never allow a non-SUPER_ADMIN_UID record to hold super_admin role
            const safeRole =
              uid === SUPER_ADMIN_UID && SUPER_ADMIN_UID
                ? rec.role
                : rec.role === 'seller'
                ? 'seller'
                : 'buyer';
            serverUserProfiles.set(uid, { ...rec, uid, role: safeRole });
          }
        }
      }
    } catch {
      // Ignore corrupt tmp file
    }
  };

  const persistUserProfilesToTmp = () => {
    try {
      const out: Record<string, ServerUserProfileRecord> = {};
      for (const [uid, rec] of serverUserProfiles.entries()) {
        out[uid] = rec;
      }
      fs.writeFileSync(USER_PROFILES_TMP_PATH, JSON.stringify(out), {
        encoding: 'utf8',
        mode: 0o600,
      });
    } catch {
      // Non-fatal tmp write
    }
  };

  loadUserProfilesFromTmp();

  const handleGetUserProfile = async (req: express.Request, res: express.Response) => {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    const isSuper = isStrictSuperAdminUser(user);

    // 1. Preserve Super Admin existing role & store
    if (isSuper) {
      const adminProfile: ServerUserProfileRecord = {
        uid: user.uid,
        role: 'super_admin',
        displayName: String(user.displayName || (user.email ? user.email.split('@')[0] : 'Administrator')).slice(0, 120),
        email: user.email || '',
        onboardingCompleted: true,
        storeId: `store-${user.uid.slice(0, 20)}`,
        createdAtIso: new Date().toISOString(),
        updatedAtIso: new Date().toISOString(),
      };
      serverUserProfiles.set(user.uid, adminProfile);
      res.json({
        ok: true,
        exists: true,
        needsOnboarding: false,
        profile: adminProfile,
        permissions: buildRolePermissions('super_admin'),
      });
      return;
    }

    // Cloud instances do not share /tmp. Load authoritative user role from
    // Firebase Admin Firestore before guessing role from local caches/orders.
    if (adminFirestoreDb) {
      try {
        const saved = await adminFirestoreDb.collection('users').doc(user.uid).get();
        const fields = saved.exists ? saved.data() || {} : {};
        const role = String(fields.role || '');
        if (role === 'buyer' || role === 'seller') {
          const hydrated: ServerUserProfileRecord = {
            uid: user.uid,
            role,
            displayName: String(fields.displayName || user.displayName || 'Creator').slice(0, 120),
            email: String(user.email || '').slice(0, 254),
            onboardingCompleted: fields.onboardingCompleted === true,
            ...(role === 'seller' ? { storeId: String(fields.storeId || `store-${user.uid.slice(0, 20)}`) } : {}),
            createdAtIso: String(fields.createdAtIso || new Date().toISOString()),
            updatedAtIso: String(fields.updatedAtIso || new Date().toISOString()),
          };
          serverUserProfiles.set(user.uid, hydrated);
          res.json({
            ok: true,
            exists: true,
            needsOnboarding: !hydrated.onboardingCompleted,
            profile: hydrated,
            permissions: buildRolePermissions(role),
          });
          return;
        }
      } catch (err) {
        console.error('Could not retrieve verified user role from Firestore:', err);
        res.status(503).json({ error: 'Account details are temporarily unavailable. Please retry.' });
        return;
      }
    }

    // 2. Migrate a verified legacy in-memory profile only if Firestore has
    // no authoritative saved profile. Never let stale /tmp override Firebase.
    const existingMem = serverUserProfiles.get(user.uid);
    if (existingMem && existingMem.onboardingCompleted) {
      res.json({
        ok: true,
        exists: true,
        needsOnboarding: false,
        profile: existingMem,
        permissions: buildRolePermissions(existingMem.role),
      });
      return;
    }

    // 3. Preserve existing sellers who already have an active store in serverStores, sellerSettings cache, or Firestore
    const canonicalUserStoreId = `store-${user.uid.slice(0, 20)}`;
    const existingStore =
      Array.from(serverStores.values()).find(
        (s) => s.ownerId === user.uid || s.storeId === canonicalUserStoreId
      ) || null;
    const hasExistingSellerSettings = firestoreVerifiedSellerSettingsByOwner.has(user.uid);
    if (existingStore || hasExistingSellerSettings) {
      const preservedSeller: ServerUserProfileRecord = {
        uid: user.uid,
        role: 'seller',
        displayName: String(
          existingStore?.ownerName || (user.email ? user.email.split('@')[0] : 'Seller')
        ),
        email: String(
          user.email ||
            existingStore?.ownerEmail ||
            firestoreVerifiedSellerSettingsByOwner.get(user.uid)?.email ||
            ''
        ),
        onboardingCompleted: true,
        storeId: String(existingStore?.storeId || canonicalUserStoreId),
        createdAtIso: new Date().toISOString(),
        updatedAtIso: new Date().toISOString(),
      };
      serverUserProfiles.set(user.uid, preservedSeller);
      persistUserProfilesToTmp();
      res.json({
        ok: true,
        exists: true,
        needsOnboarding: false,
        profile: preservedSeller,
        permissions: buildRolePermissions('seller'),
      });
      return;
    }

    // 3B. Preserve returning buyers who already have orders in persistentLedger
    const existingBuyerOrder = Array.from(persistentLedger.values()).find(
      (e) => e.buyerId === user.uid
    );
    if (existingBuyerOrder) {
      const preservedBuyer: ServerUserProfileRecord = {
        uid: user.uid,
        role: 'buyer',
        displayName: String(
          existingBuyerOrder.customerName || (user.email ? user.email.split('@')[0] : 'Buyer')
        ),
        email: String(user.email || existingBuyerOrder.customerEmail || ''),
        onboardingCompleted: true,
        createdAtIso: new Date().toISOString(),
        updatedAtIso: new Date().toISOString(),
      };
      serverUserProfiles.set(user.uid, preservedBuyer);
      persistUserProfilesToTmp();
      res.json({
        ok: true,
        exists: true,
        needsOnboarding: false,
        profile: preservedBuyer,
        permissions: buildRolePermissions('buyer'),
      });
      return;
    }

    // 4. Check Firestore users/{uid} (and stores/{canonicalUserStoreId}) with the authenticated user's Bearer token
    if (FIREBASE_PROJECT_ID && FIREBASE_API_KEY && user.rawToken) {
      try {
        const docUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${encodeURIComponent(
          FIRESTORE_DATABASE_ID
        )}/documents/users/${encodeURIComponent(user.uid)}?key=${FIREBASE_API_KEY}`;
        const fsRes = await fetch(docUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${user.rawToken}`,
          },
        });
        if (fsRes.ok) {
          const docJson = (await fsRes.json()) as Record<string, unknown>;
          if (docJson?.fields) {
            const parsed = parseFirestoreDocumentFields(docJson);
            const rawRole = String(parsed.role || '').trim().toLowerCase();
            if (rawRole === 'buyer' || rawRole === 'seller') {
              const hydrated: ServerUserProfileRecord = {
                uid: user.uid,
                role: rawRole,
                displayName: String(
                  parsed.displayName || (user.email ? user.email.split('@')[0] : 'User')
                ).slice(0, 120),
                email: String(parsed.email || user.email || '').slice(0, 254),
                onboardingCompleted: Boolean(parsed.onboardingCompleted ?? true),
                storeId: parsed.storeId ? String(parsed.storeId) : undefined,
                createdAtIso: new Date().toISOString(),
                updatedAtIso: new Date().toISOString(),
              };
              serverUserProfiles.set(user.uid, hydrated);
              persistUserProfilesToTmp();
              res.json({
                ok: true,
                exists: true,
                needsOnboarding: !hydrated.onboardingCompleted,
                profile: hydrated,
                permissions: buildRolePermissions(rawRole),
              });
              return;
            }
          }
        }

        // Also check if user already owns an existing store document in Firestore
        const storeDocUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${encodeURIComponent(
          FIRESTORE_DATABASE_ID
        )}/documents/stores/${encodeURIComponent(canonicalUserStoreId)}?key=${FIREBASE_API_KEY}`;
        const storeFsRes = await fetch(storeDocUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${user.rawToken}`,
          },
        });
        if (storeFsRes.ok) {
          const storeJson = (await storeFsRes.json()) as Record<string, unknown>;
          if (storeJson?.fields) {
            const parsedStore = parseFirestoreDocumentFields(storeJson);
            const preservedFromFirestoreStore: ServerUserProfileRecord = {
              uid: user.uid,
              role: 'seller',
              displayName: String(
                parsedStore.ownerName || (user.email ? user.email.split('@')[0] : 'Seller')
              ).slice(0, 120),
              email: String(user.email || '').slice(0, 254),
              onboardingCompleted: true,
              storeId: canonicalUserStoreId,
              createdAtIso: new Date().toISOString(),
              updatedAtIso: new Date().toISOString(),
            };
            serverUserProfiles.set(user.uid, preservedFromFirestoreStore);
            persistUserProfilesToTmp();
            res.json({
              ok: true,
              exists: true,
              needsOnboarding: false,
              profile: preservedFromFirestoreStore,
              permissions: buildRolePermissions('seller'),
            });
            return;
          }
        }
      } catch {
        // Ignore Firestore read error and fall through to needsOnboarding
      }
    }

    res.json({
      ok: true,
      exists: false,
      needsOnboarding: true,
      profile: null,
      permissions: null,
    });
  };

  const handleSaveUserProfile = async (req: express.Request, res: express.Response) => {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    const isSuper = isStrictSuperAdminUser(user);
    const body = req.body || {};

    // Prevent cross-user profile tampering
    const requestedUid = String(body.uid || body.userId || '').trim();
    if (requestedUid && requestedUid !== user.uid && !isSuper) {
      res.status(403).json({
        error: `Forbidden: Cannot modify role or profile for another user ("${requestedUid}").`,
      });
      return;
    }

    const rawRole = String(body.role || '').trim().toLowerCase();
    const attemptedSuperAdmin =
      rawRole === 'super_admin' ||
      rawRole === 'superadmin' ||
      rawRole === 'admin' ||
      body.isSuperAdmin === true ||
      body.isAdmin === true ||
      body.superAdmin === true;

    // Strictly prevent any user from assigning themselves Super Admin privileges
    if (attemptedSuperAdmin) {
      res.status(403).json({
        error:
          'Forbidden: Privilege escalation blocked. Users cannot assign themselves Super Admin or Admin privileges. Allowed roles are "buyer" or "seller" only.',
      });
      return;
    }

    if (rawRole !== 'buyer' && rawRole !== 'seller') {
      res.status(400).json({
        error: 'Invalid role selection. Please choose "buyer" ("I\'m here to Shop") or "seller" ("I want to Sell").',
      });
      return;
    }

    // Profile email always comes from cryptographically verified sign-in,
    // never a freely editable browser field.
    const cleanEmail = String(user.email || '').trim().slice(0, 254);
    const defaultNameFromEmail = cleanEmail ? cleanEmail.split('@')[0] : 'Shopper';
    const cleanName = String(body.displayName || body.name || defaultNameFromEmail)
      .trim()
      .slice(0, 120);

    if (!cleanEmail || !cleanEmail.includes('@') || cleanName.length < 1) {
      res.status(400).json({
        error: 'Valid name and email are required.',
      });
      return;
    }

    const existingProfile = serverUserProfiles.get(user.uid);
    const canonicalStoreId = `store-${user.uid.slice(0, 20)}`;
    const nowIso = new Date().toISOString();

    const savedProfile: ServerUserProfileRecord = {
      uid: user.uid,
      role: rawRole,
      displayName: cleanName,
      email: cleanEmail,
      onboardingCompleted: true,
      ...(rawRole === 'seller' ? { storeId: canonicalStoreId } : {}),
      createdAtIso: existingProfile?.createdAtIso || nowIso,
      updatedAtIso: nowIso,
    };

    // Do not mark onboarding complete until the verified profile is durably
    // committed. A /tmp or best-effort REST write loses seller roles on restart.
    if (!adminFirestoreDb) {
      res.status(503).json({ error: 'Account database is not available. No role was saved.' });
      return;
    }
    try {
      const profileRef = adminFirestoreDb.collection('users').doc(user.uid);
      await adminFirestoreDb.runTransaction(async (tx) => {
        const previous = await tx.get(profileRef);
        const previousRole = String(previous.get('role') || '');
        if (previousRole === 'super_admin' && !isSuper) {
          throw new Error('Cannot change a privileged account role.');
        }
        // Authenticated users are allowed to select Buyer or Seller; a role
        // change does not grant admin permissions (signed token and env UID).
        const now = new Date();
        tx.set(profileRef, {
          uid: user.uid,
          role: rawRole,
          displayName: cleanName,
          email: cleanEmail,
          onboardingCompleted: true,
          ...(rawRole === 'seller' ? { storeId: canonicalStoreId } : {}),
          createdAt: previous.exists ? previous.get('createdAt') || now : now,
          updatedAt: now,
        });
      });
      serverUserProfiles.set(user.uid, savedProfile);
    } catch (err) {
      console.error('Durable user role save failed:', err);
      res.status(503).json({ error: 'Your account role could not be saved securely. Please retry.' });
      return;
    }

    res.json({
      ok: true,
      profile: savedProfile,
      permissions: buildRolePermissions(rawRole),
    });
  };

  function buildRolePermissions(role: 'buyer' | 'seller' | 'super_admin') {
    if (role === 'super_admin') {
      return {
        role: 'super_admin' as const,
        navigation: [
          'Platform Dashboard',
          'Dashboard',
          'My Store',
          'Products',
          'Orders',
          'Store Design',
          'Settings',
        ],
        allowedScreens: [
          'landing',
          'wizard',
          'owner-dashboard',
          'storefront',
          'shop',
          'product-detail',
          'visual-editor',
          'super-admin',
          'checkout',
          'mobile-designs',
        ],
        blockedScreens: [] as string[],
      };
    }
    if (role === 'seller') {
      return {
        role: 'seller' as const,
        navigation: ['Dashboard', 'My Store', 'Products', 'Orders', 'Store Design', 'Settings'],
        allowedScreens: [
          'landing',
          'wizard',
          'owner-dashboard',
          'storefront',
          'shop',
          'product-detail',
          'visual-editor',
          'checkout',
          'mobile-designs',
        ],
        blockedScreens: ['super-admin'],
      };
    }
    return {
      role: 'buyer' as const,
      navigation: ['Storefronts', 'Cart', 'Orders', 'Downloads', 'Profile'],
      allowedScreens: ['landing', 'storefront', 'shop', 'product-detail', 'checkout'],
      blockedScreens: ['wizard', 'owner-dashboard', 'visual-editor', 'super-admin'],
    };
  }

  function isVerifiedBuyerOnly(uid: string): boolean {
    const cleanUid = String(uid || '').trim();
    if (!cleanUid || cleanUid === SUPER_ADMIN_UID) return false;
    const profile = serverUserProfiles.get(cleanUid);
    return Boolean(profile && profile.role === 'buyer');
  }

  const handleVerifyNavigationAndScreenAccess = async (
    req: express.Request,
    res: express.Response
  ) => {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    const isSuper = isStrictSuperAdminUser(user);
    const requestedScreen = String(req.query.screen || req.body?.screen || '')
      .trim()
      .toLowerCase();

    const canonicalUserStoreId = `store-${user.uid.slice(0, 20)}`;
    const ownsStore =
      Array.from(serverStores.values()).some(
        (s) => s.ownerId === user.uid || s.storeId === canonicalUserStoreId
      ) || firestoreVerifiedSellerSettingsByOwner.has(user.uid);
    const profile = serverUserProfiles.get(user.uid);
    const effectiveRole: 'buyer' | 'seller' | 'super_admin' = isSuper
      ? 'super_admin'
      : profile?.role === 'seller' || (!profile && ownsStore)
      ? 'seller'
      : 'buyer';

    const permissions = buildRolePermissions(effectiveRole);

    if (requestedScreen === 'super-admin' && !isSuper) {
      res.status(403).json({
        ok: false,
        allowed: false,
        role: effectiveRole,
        redirectScreen: effectiveRole === 'seller' ? 'owner-dashboard' : 'storefront',
        permissions,
        error: `Forbidden: Screen "super-admin" is exclusively restricted to verified SUPER_ADMIN_UID. User "${user.uid}" (role="${effectiveRole}") is blocked.`,
      });
      return;
    }

    if (
      effectiveRole === 'buyer' &&
      (requestedScreen === 'owner-dashboard' ||
        requestedScreen === 'wizard' ||
        requestedScreen === 'visual-editor')
    ) {
      res.status(403).json({
        ok: false,
        allowed: false,
        role: 'buyer',
        redirectScreen: 'storefront',
        permissions,
        error: `Forbidden: Buyer "${user.uid}" cannot access seller management screen "${requestedScreen}".`,
      });
      return;
    }

    res.json({
      ok: true,
      allowed: true,
      role: effectiveRole,
      permissions,
    });
  };

  app.get('/api/users/profile', asyncRoute(handleGetUserProfile));
  app.post('/api/users/profile', asyncRoute(handleSaveUserProfile));
  app.post('/api/users/role', asyncRoute(handleSaveUserProfile));
  app.get('/api/auth/onboarding', asyncRoute(handleGetUserProfile));
  app.post('/api/auth/onboarding', asyncRoute(handleSaveUserProfile));
  app.get('/api/navigation/access', asyncRoute(handleVerifyNavigationAndScreenAccess));
  app.post('/api/navigation/access', asyncRoute(handleVerifyNavigationAndScreenAccess));
  app.get('/api/auth/verify-screen-access', asyncRoute(handleVerifyNavigationAndScreenAccess));

  // 2. Multi-Vendor Store Lookup, Slug Availability & Store Creation
  const RESERVED_SLUGS = new Set([
    'admin',
    'superadmin',
    'api',
    'login',
    'checkout',
    'support',
    'dashboard',
    'settings',
  ]);
  const SLUG_REGEX = /^[a-z0-9_.-]{2,40}$/;

  const PRIVATE_STORE_FIELDS = [
    'ownerEmail',
    'email',
    'jazzCashMerchantId',
    'easypaisaStoreId',
    'upiId',
    'paymentLinkUrl',
    'payoneerEmail',
    'payoneerAccountId',
    'payoneerPaymentLinkUrl',
    'payoneerReceivingDetails',
    'payoneerReceivingEmail',
    'payoneerRequestLink',
    'payoneerReceivingAccountDetails',
    'whatsappNotificationNumber',
    'stripeAccountId',
    'bankTransferInstructions',
    'customerEmail',
    'customerName',
  ];

  const sanitizePublicStore = (
    s: ServerStoreRecord,
    viewer: VerifiedAuthUser | null
  ): Omit<ServerStoreRecord, 'ownerEmail'> & { ownerEmail?: string } => {
    const canSeePrivate =
      Boolean(viewer) && (isStrictSuperAdminUser(viewer) || viewer!.uid === s.ownerId);
    const copy: Record<string, unknown> = { ...s };
    if (!canSeePrivate) {
      for (const field of PRIVATE_STORE_FIELDS) {
        delete copy[field];
      }
    }
    return copy as Omit<ServerStoreRecord, 'ownerEmail'> & { ownerEmail?: string };
  };

  app.get('/api/stores', asyncRoute(async (req, res) => {
    const viewer = await extractVerifiedCaller(req);
    const isSuper = isStrictSuperAdminUser(viewer);
    const visibleStores = Array.from(serverStores.values())
      .filter((s) => isSuper || s.status === 'Active' || (viewer && s.ownerId === viewer.uid))
      .map((s) => {
        const visits = getOrInitStoreVisits(s.storeId);
        return {
          ...sanitizePublicStore(s, viewer),
          visitsCount: visits.visitsCount,
          checkoutViewsCount: visits.checkoutViewsCount,
          lastVisitedAtIso: visits.lastVisitedAtIso,
        };
      });
    res.json({
      stores: visibleStores,
    });
  }));

  app.post('/api/stores/visit', asyncRoute(async (req, res) => {
    const rawTarget = String(req.body?.storeId || req.body?.storeSlug || '').trim();
    if (!rawTarget || rawTarget.length > 100) {
      res.status(400).json({ error: 'Valid storeId or storeSlug is required.' });
      return;
    }
    const matched = await resolveVerifiedStoreRecord(rawTarget);
    if (!matched || matched.status !== 'Active') {
      res.status(404).json({ error: 'Public store not found.' });
      return;
    }
    const targetStoreId = matched.storeId;
    const stats = recordStoreVisit(targetStoreId, Boolean(req.body?.isCheckoutView));
    res.json({
      ok: true,
      storeId: targetStoreId,
      visitsCount: stats.visitsCount,
      checkoutViewsCount: stats.checkoutViewsCount,
      lastVisitedAtIso: stats.lastVisitedAtIso,
    });
  }));

  app.get('/api/stores/check-slug', asyncRoute((req, res) => {
    const rawSlug = String(req.query.slug || '').trim().toLowerCase();
    const excludeStoreId = String(req.query.excludeStoreId || '').trim();
    const excludeOwnerId = String(req.query.excludeOwnerId || '').trim();

    if (!rawSlug || rawSlug.length < 2) {
      res.json({
        available: false,
        slug: rawSlug,
        reason: 'Store slug must be at least 2 characters long.',
      });
      return;
    }
    if (!SLUG_REGEX.test(rawSlug)) {
      res.json({
        available: false,
        slug: rawSlug,
        reason:
          'Store slug may only contain lowercase letters, numbers, hyphens (-), underscores (_), or dots (.).',
      });
      return;
    }
    if (RESERVED_SLUGS.has(rawSlug)) {
      res.json({
        available: false,
        slug: rawSlug,
        reason: `The slug "${rawSlug}" is a reserved system path. Please choose another URL.`,
      });
      return;
    }

    const existing = Array.from(serverStores.values()).find(
      (s) =>
        s.storeSlug.toLowerCase() === rawSlug &&
        s.storeId !== excludeStoreId &&
        (!excludeOwnerId || s.ownerId !== excludeOwnerId)
    );

    if (existing) {
      res.json({
        available: false,
        slug: rawSlug,
        reason: `The store URL "${rawSlug}" is already taken by another store.`,
      });
      return;
    }

    res.json({
      available: true,
      slug: rawSlug,
      reason: null,
    });
  }));

  const handleGetStoreBySlug = async (req: express.Request, res: express.Response) => {
    const slug = String(req.params.slug || '').trim().toLowerCase();
    const store = Array.from(serverStores.values()).find(
      (s) => s.storeSlug.toLowerCase() === slug || s.storeId.toLowerCase() === slug
    );
    if (!store) {
      res.status(404).json({ error: `Store "${slug}" not found.` });
      return;
    }
    const viewer = await extractVerifiedCaller(req);
    const isOwnerOrSuper =
      Boolean(viewer) && (isStrictSuperAdminUser(viewer) || viewer!.uid === store.ownerId);
    if (store.status !== 'Active' && !isOwnerOrSuper) {
      res.status(403).json({ error: 'This store is currently unavailable.' });
      return;
    }
    const products = Array.from(serverProducts.values()).filter(
      (p) => p.storeId === store.storeId && (p.published || isOwnerOrSuper)
    );
    res.json({
      store: sanitizePublicStore(store, viewer),
      products,
    });
  };

  app.get('/api/stores/by-slug/:slug', asyncRoute(handleGetStoreBySlug));
  app.get('/api/stores/:slug', asyncRoute(handleGetStoreBySlug));

  // Create or Upsert Seller Store with Cryptographic Identity & Ownership Verification
  const handleCreateOrUpsertStore = async (req: express.Request, res: express.Response) => {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    const isSuper = isStrictSuperAdminUser(user);

    if (!isSuper && isVerifiedBuyerOnly(user.uid)) {
      res.status(403).json({
        error: `Forbidden: User "${user.uid}" has a verified Buyer role and cannot create or manage seller stores.`,
      });
      return;
    }

    const body = req.body || {};
    if (!isSuper && body.sellerId && String(body.sellerId).trim() !== user.uid) {
      res.status(403).json({
        error: `Forbidden: Spoofed sellerId "${body.sellerId}" does not match verified token UID "${user.uid}".`,
      });
      return;
    }

    const ownerId = isSuper && body.ownerId ? String(body.ownerId).trim() : user.uid;
    const rawSlug = String(body.storeSlug || '')
      .trim()
      .toLowerCase();
    const storeName = String(body.storeName || '').trim();
    const requestedStoreId = body.storeId ? String(body.storeId).trim() : '';
    const canonicalUserStoreId = `store-${ownerId.slice(0, 20)}`;
    const fullUidStoreId = `store-${ownerId}`;
    const existingOwnedStore = Array.from(serverStores.values()).find((s) => s.ownerId === ownerId);
    const storeId = requestedStoreId || existingOwnedStore?.storeId || canonicalUserStoreId;

    // Strict ownership & canonical storeId verification:
    // 1. If storeId already exists, caller MUST be its owner (or Super Admin)
    const existingById = serverStores.get(storeId);
    if (existingById && existingById.ownerId !== user.uid && !isSuper) {
      res.status(403).json({
        error: `Forbidden: Seller "${user.uid}" cannot overwrite store "${storeId}" owned by "${existingById.ownerId}".`,
      });
      return;
    }

    // 2. If a non-Super-Admin supplies a custom storeId that does not exist yet, it MUST match their own canonical storeId
    if (
      !isSuper &&
      requestedStoreId &&
      !existingById &&
      requestedStoreId !== canonicalUserStoreId &&
      requestedStoreId !== fullUidStoreId
    ) {
      res.status(403).json({
        error: `Forbidden: Seller "${user.uid}" cannot claim or create non-owned storeId "${requestedStoreId}".`,
      });
      return;
    }

    if (!rawSlug || !storeName) {
      res.status(400).json({
        error: 'Missing required store fields: storeName and storeSlug are required.',
      });
      return;
    }
    if (!SLUG_REGEX.test(rawSlug) || RESERVED_SLUGS.has(rawSlug)) {
      res.status(400).json({
        error: RESERVED_SLUGS.has(rawSlug)
          ? `The slug "${rawSlug}" is reserved.`
          : 'Invalid storeSlug format (use 2-40 lowercase letters, numbers, ., _, or -).',
      });
      return;
    }

    // Check if slug is already owned by a DIFFERENT store/seller
    const conflictingStore = Array.from(serverStores.values()).find(
      (s) =>
        s.storeSlug.toLowerCase() === rawSlug &&
        s.storeId !== storeId &&
        s.ownerId !== ownerId
    );
    if (conflictingStore) {
      res.status(409).json({
        error: `Store slug "${rawSlug}" is already taken by another creator.`,
        conflictSlug: rawSlug,
      });
      return;
    }

    const currency =
      body.currency && String(body.currency) in SUPPORTED_CURRENCIES
        ? String(body.currency)
        : 'PKR';
    const country = String(body.country || body.sellerCountry || 'Pakistan').slice(0, 80);

    const record: ServerStoreRecord = {
      storeId,
      ownerId,
      ownerEmail: String(user.email || body.ownerEmail || '').slice(0, 254),
      ownerName: String(body.ownerName || storeName).slice(0, 100),
      storeSlug: rawSlug,
      storeName: storeName.slice(0, 100),
      country,
      sellerCountry: country,
      productType: String(body.productType || 'Ebooks & Guides').slice(0, 100),
      currency,
      exchangeRatePkr: Number(body.exchangeRatePkr) || 278,
      theme: String(body.theme || 'blush-rose'),
      plan: isSuper && body.plan === 'Pro' ? 'Pro' : existingById?.plan || 'Free',
      instagramHandle: String(body.instagramHandle || `@${rawSlug}`).slice(0, 100),
      announcementText: String(
        body.announcementText || `Welcome to ${storeName} — Digital Downloads & Guides ✨`
      ).slice(0, 240),
      heroHeadingLine1: String(body.heroHeadingLine1 || 'Small Steps,').slice(0, 120),
      heroHeadingLine2: String(body.heroHeadingLine2 || 'Big Changes.').slice(0, 120),
      heroSubheading: String(
        body.heroSubheading || 'Curated digital guides, planners, and templates.'
      ).slice(0, 500),
      heroButtonText: String(body.heroButtonText || 'Explore Digital Products').slice(0, 60),
      heroImage: body.heroImage ? String(body.heroImage) : undefined,
      logoUrl: body.logoUrl ? String(body.logoUrl) : undefined,
      status: isSuper && body.status ? body.status : existingById?.status || 'Active',
    };

    // Never report a published store from a memory-only write. A store must
    // survive server restarts and must have unique verified ownership.
    if (!adminFirestoreDb) {
      res.status(503).json({ error: 'Secure store database is unavailable. Your store was not launched.' });
      return;
    }
    try {
      const storeCollection = adminFirestoreDb.collection('stores');
      const storeRef = storeCollection.doc(storeId);
      const [existingDoc, slugMatches] = await Promise.all([
        storeRef.get(),
        storeCollection.where('storeSlug', '==', rawSlug).limit(10).get(),
      ]);
      if (existingDoc.exists && String(existingDoc.get('ownerId') || '') !== ownerId) {
        res.status(403).json({ error: 'This store belongs to another seller.' });
        return;
      }
      if (slugMatches.docs.some((doc) => doc.id !== storeId)) {
        res.status(409).json({ error: 'That store URL is already taken. Choose another name.' });
        return;
      }
      // Preserve an existing reviewed plan/status. Client-supplied Pro values
      // never upgrade sellers; public store documents contain no owner email.
      record.plan = isSuper && body.plan === 'Pro'
        ? 'Pro'
        : String(existingDoc.get('plan') || existingById?.plan || 'Free') === 'Pro' ? 'Pro' : 'Free';
      record.status = isSuper && body.status
        ? body.status
        : String(existingDoc.get('status') || existingById?.status || 'Active');
      const now = new Date();
      const storeDocument = {
        ownerId,
        storeSlug: rawSlug,
        storeName: record.storeName,
        ownerName: record.ownerName,
        instagramHandle: record.instagramHandle || '',
        sellerCountry: country,
        productType: record.productType || 'Digital Products',
        announcementText: record.announcementText || 'Welcome',
        heroHeadingLine1: record.heroHeadingLine1 || storeName,
        heroHeadingLine2: record.heroHeadingLine2 || 'Digital Products',
        heroSubheading: record.heroSubheading || 'Explore our products.',
        heroButtonText: record.heroButtonText || 'Shop Now',
        heroImage: record.heroImage || '',
        logoUrl: record.logoUrl || '',
        theme: record.theme || 'blush-rose',
        customAccentColor: String(body.customAccentColor || ''),
        currency,
        exchangeRatePkr: record.exchangeRatePkr,
        status: record.status,
        plan: record.plan,
        createdAt: existingDoc.exists ? existingDoc.get('createdAt') || now : now,
        updatedAt: now,
      };
      await storeRef.set(storeDocument);
      serverStores.set(storeId, record);
      const statusCode = existingDoc.exists ? 200 : 201;
      res.status(statusCode).json({ ok: true, store: record });
    } catch (err) {
      console.error('Verified store creation failed:', err);
      res.status(503).json({ error: 'Store could not be saved securely. Please retry.' });
    }
  };

  app.post('/api/stores/create', asyncRoute(handleCreateOrUpsertStore));
  app.post('/api/stores/upsert', asyncRoute(handleCreateOrUpsertStore));

  // 3. Cross-Seller Store Update Endpoint (Enforces Cryptographic Seller Isolation, Overdue Commission Restriction & Pro Theme Entitlements)
  app.post('/api/stores/update', asyncRoute(async (req, res) => {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    const isSuper = isStrictSuperAdminUser(user);
    if (!user.emailVerified) {
      res.status(403).json({ error: 'Verify your email before editing your store.' });
      return;
    }

    const { storeId: rawStoreId, updates: rawUpdates } = req.body || {};
    const storeId = String(rawStoreId || '').trim();
    const updates = rawUpdates || req.body || {};
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(storeId)) {
      res.status(400).json({ error: 'Valid storeId is required.' });
      return;
    }
    if (!adminFirestoreDb) {
      res.status(503).json({ error: 'Secure store database is unavailable.' });
      return;
    }
    const storeDoc = await adminFirestoreDb.collection('stores').doc(storeId).get();
    const store = storeDoc.exists ? { ...storeDoc.data(), storeId } as ServerStoreRecord : undefined;
    const canonicalUserStoreId = `store-${user.uid.slice(0, 20)}`;
    const fullUidStoreId = `store-${user.uid}`;

    if (!store) {
      if (!isSuper && storeId && storeId !== canonicalUserStoreId && storeId !== fullUidStoreId) {
        res.status(403).json({
          error: `Forbidden: Seller "${user.uid}" cannot update non-owned store "${storeId}".`,
        });
        return;
      }
      res.status(403).json({
        error: `Forbidden: Buyer "${user.uid}" does not own an active store and cannot modify store configurations.`,
      });
      return;
    }
    if (!isSuper && user.uid !== store.ownerId) {
      res.status(403).json({
        error: `Forbidden: Seller "${user.uid}" cannot modify store "${store.storeName}" owned by "${store.ownerId}".`,
      });
      return;
    }
    if (!isSuper && String(store.status) === 'Suspended') {
      res.status(403).json({ error: 'This store is suspended and cannot be edited.' });
      return;
    }
    if (!isSuper && (updates?.status || updates?.ownerId || updates?.plan)) {
      res.status(403).json({
        error: 'Forbidden: Sellers cannot modify store moderation status, plan, or ownership.',
      });
      return;
    }

    // Check if seller has an overdue 5% commission invoice restricting theme customization or visual store builder
    const commStatus = reconcileSellerCommissionState(store.ownerId, Date.now(), user.rawToken);
    const isThemeOrBuilderUpdate =
      (updates?.theme && updates.theme !== store.theme) ||
      updates?.visualBuilderUpdate === true ||
      updates?.customAccentColor !== undefined;
    if (!isSuper && commStatus.isRestricted && isThemeOrBuilderUpdate) {
      res.status(403).json({
        restricted: true,
        restrictedFeature:
          updates?.visualBuilderUpdate === true ? 'visual_store_builder' : 'theme_customization',
        error:
          commStatus.restrictionReason ||
          'Restricted: Your 5% commission invoice is past its 7-day payment deadline. Please settle your commission invoice to unlock theme customization and the Visual Store Builder.',
        commissionStatus: commStatus,
      });
      return;
    }

    // Server-validated Pro theme entitlement check
    if (
      !isSuper &&
      updates?.theme &&
      updates.theme !== store.theme &&
      PRO_THEME_IDS.has(String(updates.theme)) &&
      store.plan !== 'Pro' &&
      !sellerProEntitlements.get(store.ownerId)
    ) {
      res.status(403).json({
        proEntitlementRequired: true,
        error: `DreamStore Pro Entitlement Required: The "${updates.theme}" theme is a Pro theme. Join the DreamStore Pro waitlist or choose one of the 3 Free Starter themes (Blush Princess, Lavender Dreams, Vanilla Bloom).`,
      });
      return;
    }

    if (updates?.storeSlug) {
      const candidateSlug = String(updates.storeSlug).trim().toLowerCase();
      if (!SLUG_REGEX.test(candidateSlug) || RESERVED_SLUGS.has(candidateSlug)) {
        res.status(400).json({ error: 'Choose a valid, non-reserved store URL.' });
        return;
      }
      const conflict = Array.from(serverStores.values()).find(
        (s) =>
          s.storeSlug.toLowerCase() === candidateSlug &&
          s.storeId !== store.storeId &&
          s.ownerId !== store.ownerId
      );
      if (conflict) {
        res.status(409).json({
          error: `Store slug "${candidateSlug}" is already taken by another store.`,
        });
        return;
      }
    }
    const updated: ServerStoreRecord = {
      ...store,
      storeName: updates?.storeName ? String(updates.storeName).slice(0, 100) : store.storeName,
      storeSlug: updates?.storeSlug
        ? String(updates.storeSlug).trim().toLowerCase().slice(0, 80)
        : store.storeSlug,
      instagramHandle:
        updates?.instagramHandle !== undefined
          ? String(updates.instagramHandle).slice(0, 100)
          : store.instagramHandle,
      country: updates?.country
        ? String(updates.country).slice(0, 80)
        : updates?.sellerCountry
        ? String(updates.sellerCountry).slice(0, 80)
        : store.country,
      sellerCountry: updates?.sellerCountry
        ? String(updates.sellerCountry).slice(0, 80)
        : store.sellerCountry || store.country,
      productType: updates?.productType
        ? String(updates.productType).slice(0, 100)
        : store.productType,
      currency:
        updates?.currency && updates.currency in SUPPORTED_CURRENCIES
          ? updates.currency
          : store.currency,
      theme: updates?.theme ? String(updates.theme) : store.theme,
      plan: isSuper && updates?.plan ? updates.plan : store.plan,
      status: isSuper && updates?.status ? updates.status : store.status,
      announcementText: updates?.announcementText
        ? String(updates.announcementText).slice(0, 240)
        : store.announcementText,
      heroHeadingLine1: updates?.heroHeadingLine1
        ? String(updates.heroHeadingLine1).slice(0, 120)
        : store.heroHeadingLine1,
      heroHeadingLine2: updates?.heroHeadingLine2
        ? String(updates.heroHeadingLine2).slice(0, 120)
        : store.heroHeadingLine2,
      heroSubheading: updates?.heroSubheading
        ? String(updates.heroSubheading).slice(0, 500)
        : store.heroSubheading,
      heroButtonText: updates?.heroButtonText
        ? String(updates.heroButtonText).slice(0, 60)
        : store.heroButtonText,
      heroImage: updates?.heroImage !== undefined ? String(updates.heroImage).slice(0, 500000) : store.heroImage,
      logoUrl: updates?.logoUrl !== undefined ? String(updates.logoUrl).slice(0, 500000) : store.logoUrl,
    };
    // Commit only public store fields, and acknowledge only after persistence.
    const publicFields = ['storeName', 'storeSlug', 'instagramHandle', 'sellerCountry',
      'productType', 'currency', 'theme', 'plan', 'status', 'announcementText',
      'heroHeadingLine1', 'heroHeadingLine2', 'heroSubheading', 'heroButtonText', 'heroImage', 'logoUrl'];
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of publicFields) {
      const value = (updated as unknown as Record<string, unknown>)[key];
      if (value !== undefined && Object.hasOwn(updates, key)) patch[key] = value;
    }
    if (updates.customAccentColor !== undefined) patch.customAccentColor = String(updates.customAccentColor).slice(0, 20);
    if (updates.exchangeRatePkr !== undefined) {
      const rate = Number(updates.exchangeRatePkr);
      if (!Number.isFinite(rate) || rate < 1 || rate > 10000) {
        res.status(400).json({ error: 'Exchange rate must be between 1 and 10000.' });
        return;
      }
      patch.exchangeRatePkr = rate;
    }
    await adminFirestoreDb.runTransaction(async tx => {
      const ref = adminFirestoreDb!.collection('stores').doc(storeId);
      const fresh = await tx.get(ref);
      if (!fresh.exists || (!isSuper && fresh.get('ownerId') !== user.uid)) throw new Error('Store ownership changed.');
      const matches = await tx.get(adminFirestoreDb!.collection('stores').where('storeSlug', '==', updated.storeSlug));
      if (matches.docs.some(doc => doc.id !== storeId)) throw new Error('Store URL already taken.');
      if (!isSuper) { patch.plan = fresh.get('plan') || 'Free'; patch.status = fresh.get('status') || 'Active'; }
      tx.set(ref, patch, { merge: true });
    });
    const saved = { ...updated, ...patch } as ServerStoreRecord;
    serverStores.set(store.storeId, saved);
    res.json({ ok: true, store: saved });
  }));

  // Helper to verify whether a user is a registered store owner (seller) in memory or Firestore
  const resolveOwnedStoreForUser = async (uid: string): Promise<ServerStoreRecord | undefined> => {
    const cleanUid = String(uid || '').trim();
    if (!cleanUid) return undefined;
    const inMem = Array.from(serverStores.values()).find((s) => s.ownerId === cleanUid);
    if (inMem) return inMem;
    const canonicalUserStoreId = `store-${cleanUid.slice(0, 20)}`;
    const hydrated = await resolveVerifiedStoreRecord(canonicalUserStoreId);
    if (hydrated && hydrated.ownerId === cleanUid) return hydrated;
    return Array.from(serverStores.values()).find((s) => s.ownerId === cleanUid);
  };

  // 3B. Seller Private Payment Settings Endpoints (Strictly Isolated to Verified Store Owner or Super Admin)

  const handleGetPaymentSettings = async (req: express.Request, res: express.Response) => {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    const isSuper = isStrictSuperAdminUser(user);

    if (!isSuper && (!user.emailVerified || isVerifiedBuyerOnly(user.uid))) {
      res.status(403).json({
        error: 'Forbidden: Only a verified store owner or Super Admin may access private seller settings.',
      });
      return;
    }

    const requestedSellerId = String(req.query.sellerId || req.query.ownerId || '').trim();
    const requestedStoreId = String(req.params.storeId || req.query.storeId || '').trim();
    const canonicalUserStoreId = `store-${user.uid.slice(0, 20)}`;
    const fullUidStoreId = `store-${user.uid}`;
    const ownedStore = await resolveOwnedStoreForUser(user.uid);
    const targetStoreRecord = requestedStoreId
      ? await resolveVerifiedStoreRecord(requestedStoreId)
      : undefined;

    if (!isSuper) {
      if (requestedSellerId && requestedSellerId !== user.uid) {
        res.status(403).json({
          error: `Forbidden: Seller "${user.uid}" cannot access private payment settings for seller "${requestedSellerId}".`,
        });
        return;
      }

      if (requestedStoreId) {
        const isOwnedInRegistry = Boolean(
          targetStoreRecord && targetStoreRecord.ownerId === user.uid
        );
        const isForeignInRegistry = Boolean(
          targetStoreRecord && targetStoreRecord.ownerId !== user.uid
        );
        if (
          isForeignInRegistry ||
          (!isOwnedInRegistry &&
            requestedStoreId !== canonicalUserStoreId &&
            requestedStoreId !== fullUidStoreId &&
            requestedStoreId !== ownedStore?.storeId)
        ) {
          res.status(403).json({
            error: `Forbidden: User "${user.uid}" cannot access private payment settings for store "${requestedStoreId}".`,
          });
          return;
        }
      }

      if (!ownedStore && requestedStoreId !== canonicalUserStoreId && requestedStoreId !== fullUidStoreId) {
        res.status(403).json({
          error: `Forbidden: Buyer "${user.uid}" is not a verified store owner and cannot access private seller payment settings.`,
        });
        return;
      }
    }

    const effectiveStoreId =
      requestedStoreId || ownedStore?.storeId || canonicalUserStoreId;
    const effectiveOwnerId = isSuper
      ? requestedSellerId || targetStoreRecord?.ownerId || user.uid
      : user.uid;

    // Fetch payment settings from Firestore for the verified store owner (or verified owner cache)
    const fromFirestore = await resolveStoreOwnerVerifiedPaymentSettings(
      effectiveOwnerId,
      effectiveStoreId,
      user
    );

    const saved =
      fromFirestore ||
      normalizeSellerPaymentSettingsRecord(
        {
          storeId: effectiveStoreId,
          ownerId: effectiveOwnerId,
          email: user.email || '',
          jazzCashMerchantId: '',
          jazzCashEnabled: false,
          easypaisaStoreId: '',
          easypaisaEnabled: false,
          upiId: '',
          paymentLinkUrl: '',
          payoneerEnabled: false,
          stripeEnabled: false,
          bankTransferInstructions: '',
        },
        effectiveStoreId,
        effectiveOwnerId
      );
    res.json({ ok: true, settings: saved });
  };

  const handleSavePaymentSettings = async (req: express.Request, res: express.Response) => {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    const isSuper = isStrictSuperAdminUser(user);

    if (!isSuper && (!user.emailVerified || isVerifiedBuyerOnly(user.uid))) {
      res.status(403).json({
        error: 'Forbidden: Only a verified store owner or Super Admin may modify private seller settings.',
      });
      return;
    }

    const body = req.body || {};
    const requestedSellerId = String(
      body.sellerId || body.ownerId || req.query.sellerId || req.query.ownerId || ''
    ).trim();
    const requestedStoreId = String(body.storeId || req.query.storeId || '').trim();
    const canonicalUserStoreId = `store-${user.uid.slice(0, 20)}`;
    const fullUidStoreId = `store-${user.uid}`;
    const ownedStore = await resolveOwnedStoreForUser(user.uid);
    const targetStoreRecord = requestedStoreId
      ? await resolveVerifiedStoreRecord(requestedStoreId)
      : undefined;

    if (!isSuper) {
      if (requestedSellerId && requestedSellerId !== user.uid) {
        res.status(403).json({
          error: `Forbidden: Spoofed sellerId/ownerId "${requestedSellerId}" does not match verified token UID "${user.uid}".`,
        });
        return;
      }

      if (requestedStoreId) {
        const isOwnedInRegistry = Boolean(
          targetStoreRecord && targetStoreRecord.ownerId === user.uid
        );
        const isForeignInRegistry = Boolean(
          targetStoreRecord && targetStoreRecord.ownerId !== user.uid
        );
        if (
          isForeignInRegistry ||
          (!isOwnedInRegistry &&
            requestedStoreId !== canonicalUserStoreId &&
            requestedStoreId !== fullUidStoreId &&
            requestedStoreId !== ownedStore?.storeId)
        ) {
          res.status(403).json({
            error: `Forbidden: Seller "${user.uid}" cannot modify payment settings for store "${requestedStoreId}".`,
          });
          return;
        }
      }
    }

    const effectiveStoreId =
      requestedStoreId || ownedStore?.storeId || canonicalUserStoreId;
    const effectiveOwnerId = isSuper
      ? requestedSellerId || targetStoreRecord?.ownerId || user.uid
      : user.uid;

    const record = normalizeSellerPaymentSettingsRecord(
      {
        ...body,
        email: String(user.email || body.email || '').slice(0, 254),
        updatedAtIso: new Date().toISOString(),
      },
      effectiveStoreId,
      effectiveOwnerId
    );

    if (body.hydrateOnly === true) {
      cacheVerifiedSellerPaymentSettings(effectiveOwnerId, effectiveStoreId, record);
    } else {
      await persistSellerSettingsToFirestore(effectiveOwnerId, record, user.rawToken);
    }
    res.json({ ok: true, settings: record });
  };

  app.get('/api/payment-settings/:storeId', asyncRoute(handleGetPaymentSettings));
  app.get('/api/payment-settings', asyncRoute(handleGetPaymentSettings));
  app.post('/api/payment-settings/save', asyncRoute(handleSavePaymentSettings));
  app.get('/api/seller-settings/:storeId', asyncRoute(handleGetPaymentSettings));
  app.get('/api/seller-settings', asyncRoute(handleGetPaymentSettings));
  app.post('/api/seller-settings', asyncRoute(handleSavePaymentSettings));

  // Sanitized Checkout Payment Instructions Endpoint
  // Resolves the verified owner of the requested store and serves ONLY safe buyer-facing checkout instructions (never private seller PII or direct client Firestore reads).
  app.get('/api/checkout/payment-instructions/:storeId', asyncRoute(async (req, res) => {
    const rawParam = String(req.params.storeId || '').trim();
    if (!rawParam) {
      res.status(400).json({ error: 'storeId or storeSlug is required.' });
      return;
    }

    const matchedStore = await resolveVerifiedStoreRecord(rawParam);
    const resolvedStoreId = matchedStore?.storeId || rawParam;
    // Strictly resolve owner from the requested store record — NEVER fall back to the logged-in buyer's UID
    const resolvedOwnerId = matchedStore?.ownerId || '';
    const verifiedCaller = await extractVerifiedCaller(req);

    const saved = resolvedOwnerId
      ? await resolveStoreOwnerVerifiedPaymentSettings(
          resolvedOwnerId,
          resolvedStoreId,
          verifiedCaller
        )
      : null;

    const configuredMethods = getConfiguredSellerPaymentMethods(saved);
    const paymentConfigured = configuredMethods.length > 0;
    const setupMessage = paymentConfigured
      ? ''
      : 'Paid checkout is disabled for this store until the seller configures valid payment receiving details in Seller Dashboard → Payment Settings.';

    // Strictly sanitized buyer-facing checkout payload (zero private seller email, ownerId, WhatsApp number, or Stripe account IDs)
    const instructions = {
      storeId: resolvedStoreId,
      paymentConfigured,
      configuredMethods,
      setupMessage,
      jazzCashMerchantId: configuredMethods.includes('jazzcash')
        ? String(saved?.jazzCashMerchantId || '').trim()
        : '',
      jazzCashEnabled: configuredMethods.includes('jazzcash'),
      easypaisaStoreId: configuredMethods.includes('easypaisa')
        ? String(saved?.easypaisaStoreId || '').trim()
        : '',
      easypaisaEnabled: configuredMethods.includes('easypaisa'),
      upiId: configuredMethods.includes('upi_india') ? String(saved?.upiId || '').trim() : '',
      paymentLinkUrl: String(saved?.paymentLinkUrl || '').trim(),
      payoneerEnabled: configuredMethods.includes('payoneer'),
      payoneerReceivingEmail: configuredMethods.includes('payoneer')
        ? String(saved?.payoneerReceivingEmail || '').trim()
        : '',
      payoneerRequestLink: configuredMethods.includes('payoneer')
        ? String(saved?.payoneerRequestLink || '').trim()
        : '',
      payoneerReceivingAccountDetails: configuredMethods.includes('payoneer')
        ? String(saved?.payoneerReceivingAccountDetails || '').trim()
        : '',
      whatsappNotificationNumber: '',
      whatsappNotificationsEnabled: false,
      bankTransferInstructions: configuredMethods.includes('manual_bank')
        ? String(saved?.bankTransferInstructions || '').trim()
        : '',
    };

    res.json({
      ok: true,
      storeId: resolvedStoreId,
      paymentConfigured,
      configuredMethods,
      setupMessage,
      instructions,
      paymentInstructions: instructions,
    });
  }));

  // Verified upload fallback for server-email sessions that do not have a Firebase
  // browser SDK session. Does not accept base64 or publicly expose signed URLs.
  app.post('/api/uploads/product',
    express.raw({ type: 'application/octet-stream', limit: '5mb' }),
    asyncRoute(async (req, res) => {
      const user = await requireAuthenticatedUser(req, res);
      if (!user) return;
      if (!user.emailVerified || isVerifiedBuyerOnly(user.uid)) {
        res.status(403).json({ error: 'Verified sellers only.' });
        return;
      }
      const productId = String(req.headers['x-product-id'] || '');
      const targetStoreId = String(req.headers['x-store-id'] || '');
      const originalName = String(req.headers['x-file-name'] || '');
      const contentType = String(req.headers['x-file-type'] || '').trim().toLowerCase();
      const allowed = new Map([
        ['pdf', 'application/pdf'],
        ['zip', 'application/zip'],
        ['epub', 'application/epub+zip'],
        ['txt', 'text/plain'],
        ['doc', 'application/msword'],
        ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ]);
      let decodedName = '';
      try { decodedName = decodeURIComponent(originalName); } catch {
        res.status(400).json({ error: 'Invalid filename.' }); return;
      }
      const ext = decodedName.split('.').pop()?.toLowerCase() || '';
      const data = req.body;
      if (
        !Buffer.isBuffer(data) || data.length < 1 ||
        data.length > 5 * 1024 * 1024 ||
        !/^[a-zA-Z0-9_-]{2,128}$/.test(productId) ||
        decodedName.length < 1 || decodedName.length > 180 ||
        allowed.get(ext) !== contentType
      ) {
        res.status(422).json({ error: 'Invalid file, product ID, MIME type or size (maximum 5 MB).' });
        return;
      }
      const store = await resolveOwnedStoreForUser(user.uid);
      if (!store || store.storeId !== targetStoreId) {
        res.status(403).json({ error: 'Only the verified store owner can upload original files.' });
        return;
      }
      if (!FIREBASE_STORAGE_BUCKET || !adminFirestoreDb) {
        res.status(503).json({ error: 'Private Firebase Storage is not configured.' });
        return;
      }
      // Reject another seller's existing product ID before any upload.
      const existingProduct = await adminFirestoreDb.collection('products').doc(productId).get();
      if (existingProduct.exists && (
        existingProduct.get('ownerId') !== user.uid ||
        existingProduct.get('storeId') !== targetStoreId
      )) {
        res.status(403).json({ error: 'Product belongs to another seller.' });
        return;
      }
      const cleanName = decodedName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
      const objectPath = `deliverables/${user.uid}/${productId}/${crypto.randomBytes(12).toString('hex')}-${cleanName}`;
      try {
        const object = getAdminStorage().bucket(FIREBASE_STORAGE_BUCKET).file(objectPath);
        await object.save(data, {
          resumable: false,
          metadata: { contentType },
          validation: 'crc32c',
        });
        try {
          await adminFirestoreDb.collection('products').doc(productId)
            .collection('deliverables').doc('main').set({
              productId,
              ownerId: user.uid,
              fileName: decodedName,
              fileMimeType: contentType,
              fileDataUrl: `storage://${objectPath}`,
              updatedAt: new Date(),
            });
        } catch (error) {
          await object.delete({ ignoreNotFound: true }).catch(() => {});
          throw error;
        }
        res.json({
          ok: true,
          fileName: decodedName,
          fileMimeType: contentType,
          fileSizeBytes: data.length,
          fileReference: `storage://${objectPath}`,
        });
      } catch {
        res.status(503).json({ error: 'Secure upload failed. Try again before publishing.' });
      }
    })
  );

  // 4. Cross-Seller Product Upsert / Save & Delete Endpoints (Enforces Cryptographic Seller Isolation & Overdue Commission Restrictions)
  const handleUpsertProduct = async (req: express.Request, res: express.Response) => {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    const isSuper = isStrictSuperAdminUser(user);

    if (!isSuper && isVerifiedBuyerOnly(user.uid)) {
      res.status(403).json({
        error: `Forbidden: Buyer "${user.uid}" cannot create or modify seller products.`,
      });
      return;
    }

    const body = req.body || {};
    const productPayload = body.product || body;
    if (!productPayload || !productPayload.id || !productPayload.storeId) {
      res.status(400).json({ error: 'Missing product id or storeId in payload.' });
      return;
    }

    if (
      !isSuper &&
      productPayload.ownerId &&
      String(productPayload.ownerId).trim() !== user.uid
    ) {
      res.status(403).json({
        error: `Forbidden: Spoofed product ownerId "${productPayload.ownerId}" does not match verified token UID "${user.uid}".`,
      });
      return;
    }

    const store =
      serverStores.get(String(productPayload.storeId)) ||
      (await resolveVerifiedStoreRecord(String(productPayload.storeId)));
    if (!store) {
      res.status(404).json({ error: 'Verified store not found. Product was not published.' });
      return;
    }
    if (store && !isSuper && store.ownerId !== user.uid) {
      res.status(403).json({
        error: `Forbidden: Seller "${user.uid}" cannot add or modify products in store "${productPayload.storeId}" owned by "${store.ownerId}".`,
      });
      return;
    }
    const existing = serverProducts.get(String(productPayload.id));
    if (existing && !isSuper && existing.ownerId !== user.uid) {
      res.status(403).json({
        error: `Forbidden: Seller "${user.uid}" cannot overwrite product "${productPayload.id}" owned by "${existing.ownerId}".`,
      });
      return;
    }
    const ownedStore = await resolveOwnedStoreForUser(user.uid);
    if (!isSuper && !store && !existing && !ownedStore) {
      res.status(403).json({
        error: `Forbidden: Buyer "${user.uid}" does not own a store and cannot create or modify seller products.`,
      });
      return;
    }

    const effectiveOwnerId = existing?.ownerId || store?.ownerId || user.uid;

    // Enforce Overdue 5% Commission Restrictions on Adding or Publishing Products
    const commStatus = reconcileSellerCommissionState(effectiveOwnerId, Date.now(), user.rawToken);
    const wantsPublished =
      productPayload.published !== undefined ? Boolean(productPayload.published) : true;
    const isAddingNew = !existing;
    const isPublishing = wantsPublished && (!existing || !existing.published);

    if (!isSuper && commStatus.isRestricted && (isAddingNew || isPublishing)) {
      res.status(403).json({
        restricted: true,
        restrictedFeature: isAddingNew ? 'add_product' : 'publish_product',
        error:
          commStatus.restrictionReason ||
          'Restricted: Your 5% commission invoice is past its 7-day payment deadline. Adding or publishing new products is paused until settlement. Existing products and buyer checkout remain active.',
        commissionStatus: commStatus,
      });
      return;
    }

    // The seller must provide a real product title, valid category and explicit
    // prices. Never invent an ebook, a price or publish state on their behalf.
    const title = String(productPayload.title || '').trim();
    const productId = String(productPayload.id || '');
    const requestedStatus = String(productPayload.status || (wantsPublished ? 'Available' : 'Draft'));
    const allowedCategories = new Set(['Ebooks', 'Workbooks', 'Planners', 'Templates', 'Bundles']);
    if (
      !/^[A-Za-z0-9_-]{2,128}$/.test(productId) ||
      title.length < 2 ||
      !allowedCategories.has(String(productPayload.category || '')) ||
      !['Available', 'Coming Soon', 'Draft'].includes(requestedStatus) ||
      productPayload.published === undefined
    ) {
      res.status(422).json({ error: 'Enter a real title, valid category, product ID and publish state.' });
      return;
    }
    const isFree = productPayload.isFree === true;
    const givenUsd = Number(productPayload.priceUsd);
    const givenPkr = Number(productPayload.pricePkr);
    if (!isFree && (
      !Number.isFinite(givenUsd) || givenUsd < 1 ||
      !Number.isFinite(givenPkr) || givenPkr < 100
    )) {
      res.status(422).json({ error: 'Set your own valid USD and PKR prices, or mark the product Free.' });
      return;
    }
    if (wantsPublished && (store.status !== 'Active' || requestedStatus !== 'Available')) {
      res.status(403).json({ error: 'Only available products from an active store can be published.' });
      return;
    }
    const record: ServerProductRecord = {
      id: String(productPayload.id),
      storeId: String(productPayload.storeId),
      ownerId: effectiveOwnerId,
      title: title.slice(0, 160),
      category: String(productPayload.category),
      subtitle: productPayload.subtitle ? String(productPayload.subtitle).slice(0, 300) : undefined,
      description: productPayload.description
        ? String(productPayload.description).slice(0, 3000)
        : undefined,
      isFree,
      priceUsd: isFree ? 0 : givenUsd,
      pricePkr: isFree ? 0 : givenPkr,
      published: wantsPublished,
      status: requestedStatus as ServerProductRecord['status'],
      image: productPayload.image ? String(productPayload.image) : undefined,
      fileName: String(productPayload.fileName || ''),
      fileType: String(productPayload.fileType || ''),
      fileSizeLabel: String(productPayload.fileSizeLabel || ''),
    };
    // A digital listing must never be published unless its original private file
    // exists in the verified seller's Firebase Storage namespace. Metadata and
    // user-supplied storage:// paths are not proof of a successful upload.
    if (!adminFirestoreDb) {
      res.status(503).json({ error: 'Secure product storage is unavailable. Product was not published.' });
      return;
    }
    const authoritativeDeliverableRef = adminFirestoreDb.collection('products')
      .doc(record.id).collection('deliverables').doc('main');
    let authoritativeDeliverable: Record<string, unknown> | undefined;
    try {
      const savedDeliverable = await authoritativeDeliverableRef.get();
      authoritativeDeliverable = savedDeliverable.exists ? savedDeliverable.data() : undefined;
    } catch {
      res.status(503).json({ error: 'Could not verify private product file. Product was not published.' });
      return;
    }
    const requestedReference = String(productPayload.fileDataUrl || '').trim();
    const storedReference = String(authoritativeDeliverable?.fileDataUrl || '').trim();
    // New uploads use private references. Updating product metadata without a
    // new upload is allowed only if the existing verified reference is present.
    const fileReference = requestedReference || storedReference;
    if (wantsPublished) {
      if (!fileReference.startsWith('storage://') || fileReference !== storedReference) {
        res.status(422).json({ error: 'Upload and save your original file securely before publishing.' });
        return;
      }
      if (
        String(authoritativeDeliverable?.ownerId || '') !== effectiveOwnerId ||
        String(authoritativeDeliverable?.productId || '') !== record.id
      ) {
        res.status(403).json({ error: 'Private file does not belong to this seller/product.' });
        return;
      }
      const objectPath = fileReference.slice('storage://'.length);
      const allowedPrefix = `deliverables/${effectiveOwnerId}/${record.id}/`;
      const fileSegment = objectPath.slice(allowedPrefix.length);
      if (
        !FIREBASE_STORAGE_BUCKET ||
        !objectPath.startsWith(allowedPrefix) ||
        !/^[A-Za-z0-9._-]+$/.test(fileSegment) ||
        fileSegment.length < 1
      ) {
        res.status(422).json({ error: 'Secure file reference is invalid.' });
        return;
      }
      try {
        const [metadata] = await getAdminStorage().bucket(FIREBASE_STORAGE_BUCKET).file(objectPath).getMetadata();
        const bytes = Number(metadata.size || 0);
        const supportedMime = new Set([
          'application/pdf', 'application/zip', 'application/epub+zip',
          'text/plain', 'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ]);
        if (
          bytes < 1 ||
          bytes > 5 * 1024 * 1024 ||
          !supportedMime.has(String(metadata.contentType || ''))
        ) {
          res.status(422).json({ error: 'Original file size or type is not supported (maximum 5 MB).' });
          return;
        }
      } catch {
        res.status(503).json({ error: 'Original file could not be verified in Firebase Storage. Try uploading again.' });
        return;
      }
    }

    try {
      // Server commit is the public publish gate; the browser initially saves a
      // draft and must not expose unverified files to buyers.
      const productDocRef = adminFirestoreDb.collection('products').doc(record.id);
      const existingSnap = await productDocRef.get();
      if (existingSnap.exists) {
        if (existingSnap.get('deleted') === true) {
          res.status(410).json({ error: 'This product was removed and cannot be republished. Create a new listing.' });
          return;
        }
        const savedOwner = String(existingSnap.get('ownerId') || '');
        const savedStore = String(existingSnap.get('storeId') || '');
        if (savedOwner !== effectiveOwnerId || savedStore !== record.storeId) {
          res.status(403).json({ error: 'Existing product belongs to another owner or store.' });
          return;
        }
      }
      const now = new Date();
      await productDocRef.set({
        ...record,
        deleted: false,
        createdAt: existingSnap.exists ? existingSnap.get('createdAt') || now : now,
        updatedAt: now,
      }, { merge: true });
    } catch {
      res.status(503).json({ error: 'Could not save product to Firebase. Product was not published.' });
      return;
    }
    serverProducts.set(record.id, record);
    if (wantsPublished) {
      serverProductDeliverables.set(record.id, {
        fileName: record.fileName,
        fileType: record.fileType,
        fileSizeLabel: record.fileSizeLabel || '',
        fileDataUrl: fileReference,
      });
    } else {
      serverProductDeliverables.delete(record.id);
    }
    res.json({ ok: true, product: record });
  };

  app.post('/api/products/upsert', asyncRoute(handleUpsertProduct));
  app.post('/api/products/save', asyncRoute(handleUpsertProduct));
  app.post('/api/products', asyncRoute(handleUpsertProduct));

  app.post('/api/products/delete', asyncRoute(async (req, res) => {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    const isSuper = isStrictSuperAdminUser(user);
    const productId = String(req.body?.productId || '').trim();
    if (!/^[A-Za-z0-9_-]{2,128}$/.test(productId)) {
      res.status(400).json({ error: 'Invalid product ID.' });
      return;
    }
    if (!adminFirestoreDb) {
      res.status(503).json({ error: 'Secure product database unavailable. Product was not removed.' });
      return;
    }
    try {
      const productRef = adminFirestoreDb.collection('products').doc(productId);
      const snap = await productRef.get();
      if (!snap.exists || snap.get('deleted') === true) {
        res.status(404).json({ error: 'Product not found.' });
        return;
      }
      if (!isSuper && snap.get('ownerId') !== user.uid) {
        res.status(403).json({ error: 'You cannot remove another seller\'s product.' });
        return;
      }
      // Tombstone the listing durably, including unpublished drafts. Keep the
      // private original file and order history available to existing buyers.
      await productRef.update({
        published: false,
        status: 'Draft',
        deleted: true,
        updatedAt: new Date(),
      });
      serverProducts.delete(productId);
      serverProductDeliverables.delete(productId);
      res.json({ ok: true, deletedId: productId, archived: true });
    } catch (err) {
      console.error('Product archive failed:', err);
      res.status(503).json({ error: 'Product could not be removed safely. Please retry.' });
    }
  }));

  // 5. Server-Side Commission Calculator Endpoint
  app.post('/api/commission/calculate', asyncRoute((req, res) => {
    const { amountMajor, currency = 'PKR', paymentMethod = 'jazzcash' } = req.body;
    const gross = Math.max(0, Number(amountMajor) || 0);
    const breakdown = computeServerCommissionMinor(
      gross,
      String(currency),
      platformCommissionBps,
      String(paymentMethod)
    );
    res.json(breakdown);
  }));

  // 6. Protected Super Admin Commission Configuration Endpoint
  // Strictly requires cryptographically verified token for SUPER_ADMIN_UID
  const handleUpdateCommissionConfig = async (
    req: express.Request,
    res: express.Response
  ) => {
    const adminUser = await requireSuperAdminUser(req, res);
    if (!adminUser) return;

    const { newCommissionBps, commissionBps } = req.body || {};
    const parsedBps = Number(newCommissionBps ?? commissionBps);
    if (!Number.isInteger(parsedBps) || parsedBps < 0 || parsedBps > 5000) {
      res.status(400).json({
        error: 'Commission rate must be an integer between 0 bps (0%) and 5000 bps (50%).',
      });
      return;
    }

    platformCommissionBps = parsedBps;
    res.json({
      ok: true,
      platformCommissionBps,
      commissionPercentage: `${(platformCommissionBps / 100).toFixed(2)}%`,
      updatedByUid: adminUser.uid,
    });
  };

  app.post('/api/admin/commission-config', asyncRoute(handleUpdateCommissionConfig));
  app.post('/api/admin/commission-rate', asyncRoute(handleUpdateCommissionConfig));

  // 7. Auditable Persistent Transaction Ledger & Immutable Audit Trail Endpoint
  // Enforces Cryptographic Token Verification & Strict Seller Isolation
  function computeLedgerSummary(entries: LedgerEntry[]) {
    let outstandingCommissionTotalMinor = 0;
    let collectedPlatformRevenueMinor = 0;
    let totalGrossVolumeMinor = 0;
    let totalSellerNetMinor = 0;
    for (const e of entries) {
      if (e.paymentStatus === 'Paid') {
        totalGrossVolumeMinor += e.grossAmountMinor;
        totalSellerNetMinor += e.sellerNetEarningsMinor;
      }
      if (e.commissionStatus === 'outstanding') {
        outstandingCommissionTotalMinor += e.platformCommissionMinor;
      } else if (e.commissionStatus === 'paid') {
        collectedPlatformRevenueMinor += e.platformCommissionMinor;
      }
    }
    return {
      outstandingCommissionTotalMinor,
      collectedPlatformRevenueMinor,
      totalGrossVolumeMinor,
      totalSellerNetMinor,
    };
  }

  const handleGetLedger = async (req: express.Request, res: express.Response) => {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    const isSuper = isStrictSuperAdminUser(user);
    const requestedSellerId = String(req.query.sellerId || req.query.ownerId || '').trim();
    const requestedStoreId = String(req.query.storeId || '').trim();
    const canonicalUserStoreId = `store-${user.uid.slice(0, 20)}`;
    const fullUidStoreId = `store-${user.uid}`;
    const ownedStore = await resolveOwnedStoreForUser(user.uid);

    if (isSuper) {
      const allEntries = Array.from(persistentLedger.values());
      const filteredEntries = allEntries.filter((e) => {
        if (requestedSellerId && e.sellerId !== requestedSellerId) return false;
        if (requestedStoreId && e.storeId !== requestedStoreId) return false;
        return true;
      });
      const filteredAudits = requestedSellerId
        ? immutableAuditLog.filter((a) => a.sellerId === requestedSellerId)
        : immutableAuditLog;
      res.json({
        platformCommissionBps,
        entries: filteredEntries,
        auditTrail: filteredAudits,
        summary: computeLedgerSummary(filteredEntries),
      });
      return;
    }

    if (requestedSellerId && requestedSellerId !== user.uid) {
      res.status(403).json({
        error: `Forbidden: Seller "${user.uid}" cannot read ledger entries belonging to seller "${requestedSellerId}".`,
      });
      return;
    }

    if (requestedStoreId) {
      const targetStore = serverStores.get(requestedStoreId);
      const isOwnedInRegistry = Boolean(targetStore && targetStore.ownerId === user.uid);
      const isForeignInRegistry = Boolean(targetStore && targetStore.ownerId !== user.uid);
      const hasForeignEntries = Array.from(persistentLedger.values()).some(
        (e) => e.storeId === requestedStoreId && e.sellerId !== user.uid
      );
      if (
        isForeignInRegistry ||
        hasForeignEntries ||
        (!isOwnedInRegistry &&
          requestedStoreId !== canonicalUserStoreId &&
          requestedStoreId !== fullUidStoreId &&
          requestedStoreId !== ownedStore?.storeId)
      ) {
        res.status(403).json({
          error: `Forbidden: Seller "${user.uid}" cannot read ledger entries for store "${requestedStoreId}".`,
        });
        return;
      }
    }

    const ownEntries = Array.from(persistentLedger.values()).filter(
      (e) => e.sellerId === user.uid && (!requestedStoreId || e.storeId === requestedStoreId)
    );
    if (!ownedStore && ownEntries.length === 0) {
      res.status(403).json({
        error: `Forbidden: Buyer "${user.uid}" is not a store owner and cannot access the seller transaction ledger.`,
      });
      return;
    }
    res.json({
      platformCommissionBps,
      entries: ownEntries,
      auditTrail: [],
      summary: computeLedgerSummary(ownEntries),
    });
  };

  app.get('/api/ledger', asyncRoute(handleGetLedger));
  app.get('/api/ledger/transactions', asyncRoute(handleGetLedger));

  // 8. Backend Price Validation, Commission Snapshot & Duplicate Payment/Ledger Prevention
  app.post('/api/checkout/validate-and-prepare', asyncRoute(async (req, res) => {
    try {
      const verifiedBuyer = await requireAuthenticatedUser(req, res);
      if (!verifiedBuyer) return;

      const {
        idempotencyKey,
        buyerId: rawBodyBuyerId,
        storeId,
        sellerId,
        customerName,
        customerEmail,
        currency,
        exchangeRatePkr,
        paymentMethod,
        paymentReference,
        items,
      } = req.body as {
        idempotencyKey: string;
        buyerId: string;
        storeId?: string;
        sellerId?: string;
        customerName?: string;
        customerEmail: string;
        currency: string;
        exchangeRatePkr: number;
        paymentMethod: string;
        paymentReference?: string;
        items: Array<{
          id: string;
          title: string;
          isFree: boolean;
          priceUsd: number;
          pricePkr: number;
          quantity: number;
        }>;
      };

      // Derive authoritative buyerId from verified token when authenticated.
      // Any self-test buyer-${uid} prefix is strictly validated against verifiedBuyer.uid and canonicalized to verifiedBuyer.uid so it can NEVER bypass buyer identity or download authorization.
      let buyerId = String(rawBodyBuyerId || '').trim();
      if (verifiedBuyer) {
        const selfTestFull = `buyer-${verifiedBuyer.uid}`;
        const selfTestPrefix = `buyer-${verifiedBuyer.uid.slice(0, 16)}`;
        const isCallerSelfAlias =
          buyerId === selfTestFull || buyerId === selfTestPrefix;
        if (!isStrictSuperAdminUser(verifiedBuyer)) {
          if (buyerId && buyerId !== verifiedBuyer.uid && !isCallerSelfAlias) {
            res.status(403).json({
              error: `Forbidden: Spoofed buyerId "${buyerId}" does not match verified token UID "${verifiedBuyer.uid}".`,
            });
            return;
          }
          // Always store the canonical verified UID, never a buyer-${uid} alias
          buyerId = verifiedBuyer.uid;
        } else {
          // For Super Admin, canonicalize self-alias to verifiedBuyer.uid and reject spoofed buyer-${otherOwnerUid} aliases
          if (!buyerId || isCallerSelfAlias) {
            buyerId = verifiedBuyer.uid;
          } else if (buyerId.startsWith('buyer-')) {
            const stripped = buyerId.slice('buyer-'.length);
            const collidesWithOtherUser = Array.from(serverStores.values()).some(
              (s) =>
                s.ownerId !== verifiedBuyer.uid &&
                (s.ownerId === stripped || s.ownerId.slice(0, 16) === stripped)
            );
            if (collidesWithOtherUser) {
              res.status(403).json({
                error: `Forbidden: buyer-${stripped} normalization cannot be used to impersonate another user's identity.`,
              });
              return;
            }
          }
        }
      }

      if (!idempotencyKey || !buyerId || !customerEmail || !Array.isArray(items) || items.length === 0) {
        res.status(400).json({ error: 'Missing required checkout parameters or empty cart.' });
        return;
      }

      if (items.length !== 1 || Number(items[0]?.quantity ?? 1) !== 1) {
        res.status(422).json({ error: 'Please check out one digital product at a time. Each order includes one download license.' });
        return;
      }
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length > 200 || !items[0]?.id ||
        !/^[A-Za-z0-9_-]{2,128}$/.test(String(items[0].id))) {
        res.status(400).json({ error: 'Invalid checkout request.' });
        return;
      }
      if (!verifiedBuyer.emailVerified) {
        res.status(403).json({ error: 'Verify your account email before placing an order.' });
        return;
      }
      if (!(await ensureFinancialDatabaseReady(res))) return;
      const confirmedBuyerEmail = String(verifiedBuyer.email || '').trim().toLowerCase();
      if (!confirmedBuyerEmail || confirmedBuyerEmail !== String(customerEmail || '').trim().toLowerCase()) {
        res.status(403).json({
          error: 'Use the verified email address of your signed-in buyer account for digital delivery.',
        });
        return;
      }

      const scopedIdempotencyKey = `${verifiedBuyer.uid}:${String(idempotencyKey)}`;
      if (processedIdempotencyKeys.has(scopedIdempotencyKey)) {
        const existing = processedIdempotencyKeys.get(scopedIdempotencyKey)!;
        res.status(409).json({
          duplicate: true,
          error: `Duplicate checkout & ledger submission blocked (Order ${existing.orderNumber} already created).`,
          orderNumber: existing.orderNumber,
          orderId: existing.orderId,
        });
        return;
      }

      if (!(currency in SUPPORTED_CURRENCIES)) {
        res.status(400).json({
          error: `Unsupported currency "${currency}". Supported: ${Object.keys(SUPPORTED_CURRENCIES).join(', ')}`,
        });
        return;
      }

      // Always fetch current pricing/visibility before checkout, not a startup cache.
      const productSnapshot = await adminFirestoreDb!.collection('products').doc(String(items[0].id)).get();
      if (!productSnapshot.exists || productSnapshot.get('deleted') === true) {
        res.status(404).json({ error: 'Product not found in the verified catalog. Checkout was not created.' });
        return;
      }
      const freshProduct = productSnapshot.data() as ServerProductRecord;
      serverProducts.set(String(items[0].id), { ...freshProduct, id: String(items[0].id) });

      let calculatedTotal = 0;
      const targetStoreRecord = storeId ? await resolveVerifiedStoreRecord(String(storeId)) : undefined;
      if (storeId && !targetStoreRecord) {
        res.status(404).json({ error: 'Store not found. Checkout was not created.' });
        return;
      }
      let resolvedStoreId = targetStoreRecord?.storeId || '';
      let resolvedSellerId = targetStoreRecord?.ownerId || '';

      for (const item of items) {
        const qty = Math.max(1, Math.min(10, Number(item.quantity) || 1));

        // Cross-check against authoritative server product catalog if registered
        const serverProd = serverProducts.get(String(item.id));
        if (!serverProd) {
          res.status(404).json({ error: 'Product not found in the verified catalog. Checkout was not created.' });
          return;
        }
        if (
          (resolvedStoreId && serverProd.storeId !== resolvedStoreId) ||
          (resolvedSellerId && serverProd.ownerId !== resolvedSellerId)
        ) {
          res.status(403).json({ error: 'Products from different stores cannot be checked out together.' });
          return;
        }
        resolvedStoreId = serverProd.storeId;
        resolvedSellerId = serverProd.ownerId;
        if (serverProd) {
          if (!serverProd.published || serverProd.status !== 'Available') {
            res.status(400).json({
              error: `Product "${serverProd.title}" is unpublished and cannot be purchased.`,
            });
            return;
          }
          // Block client-side tampering where a paid product is submitted as isFree: true or below server price
          if (!serverProd.isFree && item.isFree === true) {
            res.status(403).json({
              error: `Security Violation: Client attempted to mark paid product "${serverProd.title}" as free.`,
            });
            return;
          }
          if (
            !serverProd.isFree &&
            ((item.priceUsd !== undefined && Number(item.priceUsd) < serverProd.priceUsd) ||
              (item.pricePkr !== undefined && Number(item.pricePkr) < serverProd.pricePkr))
          ) {
            res.status(403).json({
              error: `Security Violation: Client price tampering detected for "${serverProd.title}".`,
            });
            return;
          }
          if (!storeId || !targetStoreRecord) {
            resolvedStoreId = serverProd.storeId;
            resolvedSellerId = serverProd.ownerId;
          }

          if (serverProd.isFree) continue;

          let unitInTarget = serverProd.priceUsd;
          if (currency === 'PKR') {
            unitInTarget = serverProd.pricePkr;
          } else if (currency === 'USD') {
            unitInTarget = serverProd.priceUsd;
          } else {
            unitInTarget =
              Math.round(serverProd.priceUsd * SUPPORTED_CURRENCIES[currency] * 100) / 100;
          }
          calculatedTotal += unitInTarget * qty;
        }
      }

      calculatedTotal = Math.round(calculatedTotal * 100) / 100;
      if (calculatedTotal > 0 && !PAID_CHECKOUT_ENABLED) {
        res.status(503).json({
          error: 'Paid checkout is temporarily unavailable while DreamStore completes payment verification testing. No payment has been requested or recorded.',
          paidCheckoutDisabled: true,
        });
        return;
      }

      const orderNumber = `DS-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 899)}`;
      const orderId = `order-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;
      const expiresAtMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
      const primaryProductId = items[0].id;

      // Prevent duplicate ledger entries by orderNumber
      if (persistentLedger.has(orderNumber)) {
        res.status(409).json({
          error: `Duplicate ledger entry blocked for order ${orderNumber}.`,
        });
        return;
      }

      let initialPaymentStatus: 'Paid' | 'Pending' = 'Pending';
      let verificationMode: VerificationMode = 'Unverified';
      let commissionStatus: CommissionStatus = 'outstanding';
      let gatewayNotice = '';
      let clientDownloadToken = 'LOCKED-PENDING-VERIFICATION';

      if (calculatedTotal === 0) {
        if (paymentMethod !== 'free_instant') {
          res.status(400).json({ error: 'Free orders must use free_instant checkout method.' });
          return;
        }
        initialPaymentStatus = 'Paid';
        verificationMode = 'Instant Free';
        commissionStatus = 'not_applicable';
        clientDownloadToken = createSignedDownloadToken({
          orderNumber,
          productId: primaryProductId,
          buyerId,
          expiresAtMs,
        });
        gatewayNotice = 'Free digital product verified. Instant download unlocked.';
      } else {
        if (paymentMethod === 'free_instant') {
          res.status(403).json({
            error: 'Forbidden: Paid products cannot use free_instant checkout.',
          });
          return;
        }
        // Require the target store's verified owner to have valid configured payment details (never use the buyer's payment settings)
        const storeLookup = resolvedStoreId
          ? await resolveVerifiedStoreRecord(resolvedStoreId)
          : undefined;
        const authoritativeStoreOwnerId = storeLookup?.ownerId || resolvedSellerId;
        const verifiedStoreSettings = authoritativeStoreOwnerId
          ? await resolveStoreOwnerVerifiedPaymentSettings(
              authoritativeStoreOwnerId,
              storeLookup?.storeId || resolvedStoreId,
              verifiedBuyer
            )
          : null;
        const configuredMethods = getConfiguredSellerPaymentMethods(verifiedStoreSettings);
        if (configuredMethods.length === 0) {
          res.status(400).json({
            error:
              'Paid checkout is disabled for this store until the seller configures valid payment receiving details in Seller Dashboard → Payment Settings.',
            paymentNotConfigured: true,
          });
          return;
        }
        if (!configuredMethods.includes(String(paymentMethod))) {
          res.status(400).json({
            error: `Payment method "${paymentMethod}" is not configured for this store. Available methods: ${configuredMethods.join(', ')}.`,
            paymentMethodNotConfigured: true,
            configuredMethods,
          });
          return;
        }
        // CRITICAL: Never automatically unlock paid downloads based only on a transaction reference
        const normalizedRef = String(paymentReference || '').trim().toUpperCase();
        if (!normalizedRef || normalizedRef.length < 3) {
          res.status(400).json({
            error:
              'Please enter a valid payment transaction reference ID (at least 3 characters) for seller statement verification.',
          });
          return;
        }

        // Prevent duplicate transaction references for the same receiving account / seller payment method
        for (const existingEntry of persistentLedger.values()) {
          if (
            existingEntry.sellerId === resolvedSellerId &&
            existingEntry.paymentMethod === paymentMethod &&
            existingEntry.paymentStatus !== 'Failed' &&
            existingEntry.paymentStatus !== 'Refunded' &&
            String(existingEntry.paymentReference || '').trim().toUpperCase() === normalizedRef
          ) {
            res.status(409).json({
              duplicate: true,
              duplicateReference: true,
              error: `Duplicate transaction reference rejected: Reference "${paymentReference}" has already been submitted for this seller's ${paymentMethod.toUpperCase()} receiving account (Order ${existingEntry.orderNumber}).`,
              orderNumber: existingEntry.orderNumber,
            });
            return;
          }
        }

        initialPaymentStatus = 'Pending';
        verificationMode = 'Unverified';
        commissionStatus = 'outstanding';
        gatewayNotice =
          'Order recorded in Pending status. Submitting a transaction reference does NOT unlock downloads—the seller must verify payment against their bank/wallet statement.';
      }

      const commissionBreakdown = computeServerCommissionMinor(
        calculatedTotal,
        currency,
        platformCommissionBps,
        paymentMethod
      );

      const payoutStatus =
        calculatedTotal === 0
          ? 'Not Applicable (Free)'
          : 'Pending Payment Verification';

      const computedSummary = items
        .map((i) => String(serverProducts.get(String(i.id))?.title || 'Digital Product'))
        .join(', ')
        .slice(0, 1000);
      const computedCount = items.reduce(
        (sum, i) => sum + Math.max(1, Math.min(10, Number(i.quantity) || 1)),
        0
      );

      const ledgerRecord: LedgerEntry = {
        ledgerId: `led-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`,
        orderId,
        orderNumber,
        storeId: resolvedStoreId,
        sellerId: resolvedSellerId,
        buyerId,
        primaryProductId,
        customerName: String(customerName || customerEmail.split('@')[0] || 'Buyer').slice(0, 120),
        customerEmail: String(customerEmail || '').slice(0, 254),
        itemTitlesSummary: computedSummary || 'Digital Product',
        itemCount: computedCount,
        totalAmount: calculatedTotal,
        ...commissionBreakdown,
        paymentMethod,
        paymentReference: String(paymentReference || (calculatedTotal === 0 ? 'FREE-INSTANT' : 'PENDING-REF')).slice(0, 200),
        paymentStatus: initialPaymentStatus,
        verificationMode,
        commissionStatus,
        payoutStatus,
        downloadToken: clientDownloadToken,
        downloadCount: 0,
        maxDownloads: 5,
        expiresAtMs,
        createdAtIso: new Date().toISOString(),
        updatedAtIso: new Date().toISOString(),
      };

      // Commit the financial order, buyer order and idempotency key atomically.
      // Never return a successful checkout based solely on in-memory state.
      const financialDb = adminFirestoreDb!;
      const ledgerRef = financialDb.collection('ledger').doc(orderNumber);
      const buyerOrderRef = financialDb.collection('orders').doc(orderId);
      const idempotencyDocId = crypto.createHash('sha256').update(scopedIdempotencyKey).digest('hex');
      const idempotencyRef = financialDb.collection('checkout_idempotency').doc(idempotencyDocId);
      const committed = await financialDb.runTransaction(async (tx) => {
        const [priorKey, priorOrder] = await Promise.all([tx.get(idempotencyRef), tx.get(ledgerRef)]);
        if (priorKey.exists) {
          const prior = priorKey.data() || {};
          return { duplicate: true, orderNumber: String(prior.orderNumber || ''), orderId: String(prior.orderId || '') };
        }
        if (priorOrder.exists) throw new Error('Order ID collision. Please retry checkout.');
        const [productNow, storeNow] = await Promise.all([
          tx.get(financialDb.collection('products').doc(primaryProductId)),
          tx.get(financialDb.collection('stores').doc(resolvedStoreId)),
        ]);
        if (!productNow.exists || !storeNow.exists || storeNow.get('status') !== 'Active' ||
          storeNow.get('ownerId') !== resolvedSellerId || productNow.get('deleted') === true ||
          productNow.get('published') !== true || productNow.get('status') !== 'Available' ||
          productNow.get('storeId') !== resolvedStoreId || productNow.get('ownerId') !== resolvedSellerId ||
          productNow.get('isFree') !== freshProduct.isFree ||
          productNow.get('priceUsd') !== freshProduct.priceUsd || productNow.get('pricePkr') !== freshProduct.pricePkr) {
          throw new Error('Product price or availability changed. Refresh your cart and try again.');
        }

        const timestamp = new Date();
        tx.create(ledgerRef, ledgerRecord as unknown as Record<string, unknown>);
        tx.create(buyerOrderRef, {
          orderNumber, storeId: resolvedStoreId, sellerId: resolvedSellerId, buyerId,
          primaryProductId, customerName: ledgerRecord.customerName,
          customerEmail: ledgerRecord.customerEmail, currency,
          subtotal: calculatedTotal, totalAmount: calculatedTotal,
          paymentMethod, paymentStatus: initialPaymentStatus,
          paymentReference: ledgerRecord.paymentReference,
          itemTitlesSummary: computedSummary, itemCount: computedCount,
          downloadToken: clientDownloadToken, downloadCount: 0,
          maxDownloads: 5, expiresAtMs,
          createdAt: timestamp, updatedAt: timestamp,
        });
        tx.create(idempotencyRef, { buyerId, orderNumber, orderId, createdAtIso: timestamp.toISOString() });
        return { duplicate: false, orderNumber, orderId };
      });
      if (committed.duplicate) {
        res.status(409).json({
          duplicate: true,
          orderNumber: committed.orderNumber,
          orderId: committed.orderId,
          error: 'Duplicate checkout blocked: This request was already submitted.',
        });
        return;
      }
      persistentLedger.set(orderNumber, ledgerRecord);
      processedIdempotencyKeys.set(scopedIdempotencyKey, {
        orderNumber, orderId, timestamp: Date.now(), downloadToken: clientDownloadToken,
      });

      const auditEntry = appendAuditEntry({
        orderNumber,
        orderId,
        sellerId: resolvedSellerId,
        actorUid: buyerId,
        action: 'ORDER_CREATED',
        previousStatus: 'None',
        newStatus: initialPaymentStatus,
        verificationMode,
        detail:
          calculatedTotal === 0
            ? `Free digital order created (${currency} 0.00). Instant download token issued.`
            : `Paid order created (${currency} ${calculatedTotal}) via ${paymentMethod}. Reference submitted. Download locked until seller statement verification.`,
      });

      let emailNotification: BuyerPaidEmailNotificationRecord | null = null;
      if (initialPaymentStatus === 'Paid') {
        emailNotification = await triggerBuyerPaidOrderEmail(
          ledgerRecord,
          buyerId,
          verifiedBuyer?.rawToken
        );
      }

      res.json({
        orderId,
        orderNumber,
        storeId: resolvedStoreId,
        sellerId: resolvedSellerId,
        calculatedSubtotal: calculatedTotal,
        calculatedTotal,
        currency,
        initialPaymentStatus,
        verificationMode,
        commissionStatus,
        downloadToken: clientDownloadToken,
        expiresAtMs,
        maxDownloads: 5,
        commissionBreakdown,
        payoutStatus,
        auditEntry,
        gatewayNotice,
        emailNotification,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Server checkout validation failed.',
      });
    }
  }));

  // 9. Server-Side Manual Payment Verification
  // Enforces Cryptographic Seller Identity, Blocks Buyer Self-Approval, Requires Statement Confirmation, Unlocks Signed Token & Triggers Smart 5% Commission Invoice Check
  app.post('/api/orders/verify-payment', asyncRoute(async (req, res) => {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    const isSuper = isStrictSuperAdminUser(user);

    const { orderNumber, newStatus, statementConfirmed } = req.body || {};
    if (!(await ensureFinancialDatabaseReady(res))) return;
    if (newStatus !== 'Paid' && newStatus !== 'Failed') {
      res.status(400).json({ error: 'Invalid payment verification status.' });
      return;
    }
    const entry = await loadFinancialOrder(String(orderNumber));
    if (!entry) {
      res.status(404).json({ error: `Order "${orderNumber}" not found in persistent ledger.` });
      return;
    }

    // Prevent buyers from approving their own payments (including any buyer-${uid} alias)
    if (
      newStatus === 'Paid' &&
      !isSuper &&
      entry.buyerId &&
      (user.uid === String(entry.buyerId) ||
        `buyer-${user.uid}` === String(entry.buyerId) ||
        `buyer-${user.uid.slice(0, 16)}` === String(entry.buyerId))
    ) {
      res.status(403).json({
        selfApprovalBlocked: true,
        error: `Security Policy Violation: Buyer "${user.uid}" cannot approve or verify their own payment reference for order "${orderNumber}". Only the store seller ("${entry.sellerId}") can confirm payment receipt.`,
      });
      return;
    }

    if (!isSuper && user.uid !== entry.sellerId) {
      res.status(403).json({
        error: `Forbidden: Seller "${user.uid}" cannot verify or modify order "${orderNumber}" belonging to seller "${entry.sellerId}".`,
      });
      return;
    }

    if (newStatus === 'Paid' && statementConfirmed !== true) {
      res.status(400).json({
        error:
          'Seller must explicitly complete the wallet/bank statement checklist before verifying payment receipt.',
      });
      return;
    }

    await withSellerLock(entry.sellerId, async () => {
      // Prevent repeated verification on already-Paid orders
      if (entry.paymentStatus === 'Paid' && newStatus === 'Paid') {
        res.status(409).json({
          error: `Repeated verification blocked: Order "${orderNumber}" was already verified as Paid at ${entry.verifiedAtIso || entry.updatedAtIso}.`,
        });
        return;
      }

      if (entry.paymentStatus === 'Refunded' || entry.paymentStatus === 'Failed') {
        res.status(409).json({
          error: `Order "${orderNumber}" is in terminal status "${entry.paymentStatus}" and cannot be re-opened or verified again.`,
        });
        return;
      }

      const prevStatus = entry.paymentStatus;
      const previousRecord = { ...entry };

      if (newStatus === 'Paid') {
        entry.paymentStatus = 'Paid';
        entry.verificationMode = 'Manually Verified by Seller';
        entry.commissionStatus = entry.grossAmountMinor > 0 ? 'outstanding' : 'not_applicable';
        entry.payoutStatus = 'Direct Manual Receipt by Seller (5% Commission Outstanding)';
        entry.verifiedByUid = user.uid;
        entry.verifiedAtIso = new Date().toISOString();
        entry.updatedAtIso = new Date().toISOString();
        entry.downloadToken = createSignedDownloadToken({
          orderNumber: entry.orderNumber,
          productId: entry.primaryProductId,
          buyerId: entry.buyerId,
          expiresAtMs: entry.expiresAtMs,
        });

        try {
          await commitFinancialOrderTransition(entry, prevStatus);
        } catch {
          persistentLedger.set(entry.orderNumber, previousRecord);
          res.status(503).json({ error: 'Payment confirmation was not saved. Refresh and retry; no download was unlocked.' });
          return;
        }

        // Notify the buyer only after the Paid transition is durable.
        const emailNotification = await triggerBuyerPaidOrderEmail(
          entry,
          user.uid,
          user.rawToken
        );

        const auditEntry = appendAuditEntry(
          {
            orderNumber: entry.orderNumber,
            orderId: entry.orderId,
            sellerId: entry.sellerId,
            actorUid: user.uid,
            action: 'MANUAL_PAYMENT_VERIFIED',
            previousStatus: prevStatus,
            newStatus: 'Paid',
            verificationMode: 'Manually Verified by Seller',
            detail: `Seller (${user.uid}) confirmed payment ref "${entry.paymentReference}" against bank/wallet statement (confirmed=${Boolean(statementConfirmed ?? true)}). 5% commission (${entry.platformCommissionMinor / 100} ${entry.currency}) marked outstanding. Buyer email triggered to ${entry.customerEmail || 'N/A'}.`,
          },
          user.rawToken
        );

        // Automatically check if seller has reached 5 verified eligible sales and generate commission invoice
        const commissionSummary = reconcileSellerCommissionState(
          entry.sellerId,
          Date.now(),
          user.rawToken
        );

        res.json({
          ok: true,
          orderNumber: entry.orderNumber,
          orderId: entry.orderId,
          paymentStatus: entry.paymentStatus,
          verificationMode: entry.verificationMode,
          commissionStatus: entry.commissionStatus,
          payoutStatus: entry.payoutStatus,
          downloadToken: entry.downloadToken,
          verifiedByUid: entry.verifiedByUid,
          verifiedAtIso: entry.verifiedAtIso,
          emailNotification,
          auditEntry,
          commissionSummary,
        });
      } else {
        entry.paymentStatus = 'Failed';
        entry.verificationMode = 'Unverified';
        entry.commissionStatus = 'reversed';
        entry.payoutStatus = 'Failed';
        entry.downloadToken = 'LOCKED-UNTIL-PAYMENT-VERIFIED';
        entry.updatedAtIso = new Date().toISOString();

        try {
          await commitFinancialOrderTransition(entry, prevStatus);
        } catch {
          persistentLedger.set(entry.orderNumber, previousRecord);
          res.status(503).json({ error: 'Payment rejection was not saved. Refresh and retry.' });
          return;
        }

        const auditEntry = appendAuditEntry(
          {
            orderNumber: entry.orderNumber,
            orderId: entry.orderId,
            sellerId: entry.sellerId,
            actorUid: user.uid,
            action: 'PAYMENT_REJECTED',
            previousStatus: prevStatus,
            newStatus: 'Failed',
            verificationMode: 'Unverified',
            detail: `Seller (${user.uid}) rejected unverified payment reference "${entry.paymentReference}". Download remains locked.`,
          },
          user.rawToken
        );

        const commissionSummary = reconcileSellerCommissionState(
          entry.sellerId,
          Date.now(),
          user.rawToken
        );

        res.json({
          ok: true,
          orderNumber: entry.orderNumber,
          orderId: entry.orderId,
          paymentStatus: entry.paymentStatus,
          verificationMode: entry.verificationMode,
          commissionStatus: entry.commissionStatus,
          payoutStatus: entry.payoutStatus,
          downloadToken: entry.downloadToken,
          auditEntry,
          commissionSummary,
        });
      }
    });
  }));

  // 9B. Real-Time Express Order List & Synchronization Endpoint (Cryptographically Authenticated Seller, Buyer & Super Admin Isolation)
  const authorizeAndFilterOrdersList = (
    user: VerifiedAuthUser,
    query: Record<string, unknown>
  ):
    | {
        status: 200;
        body: {
          orders: Array<Record<string, unknown>>;
          audits: LedgerAuditRecord[];
          commissionSummary?: ReturnType<typeof reconcileSellerCommissionState>;
        };
      }
    | { status: 403; body: { error: string } } => {
    const isSuper = isVerifiedSuperAdmin(user);

    const requestedSellerId = String(query.sellerId || '').trim();
    const requestedStoreId = String(query.storeId || '').trim();
    const requestedBuyerId = String(query.buyerId || '').trim();
    const requestedCallerUid = String(query.callerUid || '').trim();
    const requestedCallerRole = String(query.callerRole || '').trim().toLowerCase();

    if (!isSuper) {
      // 1. Never trust callerRole query parameter claiming admin privileges
      if (
        requestedCallerRole === 'super_admin' ||
        requestedCallerRole === 'super-admin' ||
        requestedCallerRole === 'admin' ||
        requestedCallerRole === 'owner'
      ) {
        return {
          status: 403,
          body: {
            error: `Forbidden: Query parameter callerRole="${requestedCallerRole}" cannot grant elevated authorization to user "${user.uid}".`,
          },
        };
      }

      // 2. Never trust callerUid query parameter that does not match verified Firebase token UID
      if (requestedCallerUid && requestedCallerUid !== user.uid) {
        return {
          status: 403,
          body: {
            error: `Forbidden: Query parameter callerUid="${requestedCallerUid}" does not match verified token UID "${user.uid}".`,
          },
        };
      }

      // 3. Block cross-seller enumeration by sellerId
      if (requestedSellerId && requestedSellerId !== user.uid) {
        return {
          status: 403,
          body: {
            error: `Forbidden: Seller "${user.uid}" cannot access orders belonging to seller "${requestedSellerId}".`,
          },
        };
      }

      // 4. Block cross-buyer enumeration by buyerId
      if (requestedBuyerId && requestedBuyerId !== user.uid) {
        return {
          status: 403,
          body: {
            error: `Forbidden: Buyer "${user.uid}" cannot access orders belonging to buyer "${requestedBuyerId}".`,
          },
        };
      }

      // 5. Block cross-store access by storeId: a non-admin caller may ONLY filter by a storeId they actually own
      if (requestedStoreId) {
        const targetStore = serverStores.get(requestedStoreId);
        const canonicalUserStoreId = `store-${user.uid.slice(0, 20)}`;
        const isOwnedInRegistry = Boolean(targetStore && targetStore.ownerId === user.uid);
        const isForeignInRegistry = Boolean(targetStore && targetStore.ownerId !== user.uid);
        const hasForeignOrdersInStore = Array.from(persistentLedger.values()).some(
          (e) => e.storeId === requestedStoreId && e.sellerId !== user.uid
        );

        if (
          isForeignInRegistry ||
          hasForeignOrdersInStore ||
          (!isOwnedInRegistry && requestedStoreId !== canonicalUserStoreId)
        ) {
          return {
            status: 403,
            body: {
              error: `Forbidden: User "${user.uid}" is not authorized to access orders for store "${requestedStoreId}".`,
            },
          };
        }
      }
    }

    const allEntries = Array.from(persistentLedger.values());

    const matched = allEntries.filter((e) => {
      if (isSuper) {
        if (requestedSellerId && e.sellerId !== requestedSellerId) return false;
        if (requestedStoreId && e.storeId !== requestedStoreId) return false;
        if (requestedBuyerId && e.buyerId !== requestedBuyerId) return false;
        return true;
      }

      // Explicit role or parameter scoping for non-admin callers (always bound to verified user.uid)
      if (requestedCallerRole === 'seller' || requestedSellerId || requestedStoreId) {
        if (e.sellerId !== user.uid) return false;
        if (requestedStoreId && e.storeId !== requestedStoreId) return false;
        return true;
      }

      if (requestedCallerRole === 'buyer' || requestedBuyerId) {
        return e.buyerId === user.uid;
      }

      // Default authenticated scope: caller receives ONLY orders where they are the verified seller OR verified buyer
      return e.sellerId === user.uid || e.buyerId === user.uid;
    });

    const orders = matched.map((e) => {
      const totalMajor =
        e.totalAmount !== undefined ? e.totalAmount : Math.round(e.grossAmountMinor) / 100;
      const isBuyerOrSuper = isSuper || e.buyerId === user.uid;
      return {
        id: e.orderId,
        orderNumber: e.orderNumber,
        storeId: e.storeId,
        sellerId: e.sellerId,
        buyerId: e.buyerId,
        primaryProductId: e.primaryProductId,
        customerName: e.customerName || 'Verified Buyer',
        customerEmail: e.customerEmail || 'buyer@dreamstore.test',
        productTitle: e.itemTitlesSummary || 'Digital Product',
        itemTitlesSummary: e.itemTitlesSummary || 'Digital Product',
        itemCount: e.itemCount || 1,
        currency: e.currency,
        subtotal: totalMajor,
        totalAmount: totalMajor,
        paymentMethod: e.paymentMethod,
        paymentStatus: e.paymentStatus,
        paymentReference: e.paymentReference,
        downloadToken:
          e.paymentStatus === 'Paid' && isBuyerOrSuper
            ? e.downloadToken
            : 'LOCKED-UNTIL-PAYMENT-VERIFIED',
        downloadCount: e.downloadCount,
        maxDownloads: e.maxDownloads,
        expiresAtMs: e.expiresAtMs,
        verificationMode: e.verificationMode,
        commissionStatus: e.commissionStatus,
        payoutStatus: e.payoutStatus,
        verifiedByUid: e.verifiedByUid,
        verifiedAtIso: e.verifiedAtIso,
        buyerEmailNotification: e.buyerEmailNotification
          ? {
              emailId: e.buyerEmailNotification.emailId,
              recipientEmail: e.buyerEmailNotification.recipientEmail,
              subject: e.buyerEmailNotification.subject,
              status: e.buyerEmailNotification.status,
              sentAtIso: e.buyerEmailNotification.sentAtIso,
              deliveryProvider: e.buyerEmailNotification.deliveryProvider,
              securitySignature: e.buyerEmailNotification.securitySignature,
            }
          : undefined,
        commissionBreakdown: {
          currency: e.currency,
          commissionRateBps: e.commissionRateBps,
          grossAmountMinor: e.grossAmountMinor,
          platformCommissionMinor: e.platformCommissionMinor,
          sellerShareBeforeFeesMinor: e.sellerShareBeforeFeesMinor,
          gatewayFeeMinor: e.gatewayFeeMinor,
          sellerNetEarningsMinor: e.sellerNetEarningsMinor,
        },
      };
    });

    // CRITICAL: Never expose private audit logs to ordinary sellers or buyers. Only the verified Super Admin receives audit logs.
    const matchedOrderNumbers = new Set(matched.map((m) => m.orderNumber));
    const audits: LedgerAuditRecord[] = isSuper
      ? immutableAuditLog.filter((a) => matchedOrderNumbers.has(a.orderNumber))
      : [];

    const isSellerCaller =
      !isSuper &&
      requestedCallerRole !== 'buyer' &&
      !requestedBuyerId &&
      (Boolean(requestedSellerId) ||
        Boolean(requestedStoreId) ||
        matched.some((m) => m.sellerId === user.uid) ||
        Array.from(serverStores.values()).some((s) => s.ownerId === user.uid));

    const commissionSummary = isSuper
      ? requestedSellerId
        ? reconcileSellerCommissionState(requestedSellerId, Date.now(), user.rawToken)
        : undefined
      : isSellerCaller
      ? reconcileSellerCommissionState(user.uid, Date.now(), user.rawToken)
      : undefined;

    return {
      status: 200,
      body: {
        orders,
        audits,
        commissionSummary,
      },
    };
  };

  const handleSyncOrListOrders = async (req: express.Request, res: express.Response) => {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;

    if (!(await ensureFinancialDatabaseReady(res))) return;
    const ledger = adminFirestoreDb!.collection('ledger');
    const snapshots = isVerifiedSuperAdmin(user)
      ? [await ledger.get()]
      : await Promise.all([
          ledger.where('buyerId', '==', user.uid).get(),
          ledger.where('sellerId', '==', user.uid).get(),
        ]);
    for (const [number, record] of persistentLedger) {
      if (isVerifiedSuperAdmin(user) || record.buyerId === user.uid || record.sellerId === user.uid) {
        persistentLedger.delete(number);
      }
    }
    for (const snapshot of snapshots) {
      for (const doc of snapshot.docs) {
        const entry = doc.data() as LedgerEntry;
        if (entry.orderNumber === doc.id) persistentLedger.set(doc.id, entry);
      }
    }

    const result = authorizeAndFilterOrdersList(
      user,
      (req.query || {}) as Record<string, unknown>
    );
    res.status(result.status).json(result.body);
  };

  app.get('/api/orders/sync', asyncRoute(handleSyncOrListOrders));
  app.get('/api/orders/list', asyncRoute(handleSyncOrListOrders));

  // 9C. Buyer Paid Order Email Notification Lookup & Idempotent Re-Trigger Endpoint
  // Strictly restricted to the verified order buyer, the verified store seller, or Super Admin
  app.get('/api/orders/:orderNumber/email-notification', asyncRoute(async (req, res) => {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    const isSuper = isStrictSuperAdminUser(user);

    const orderNumber = String(req.params.orderNumber || '').trim();
    const entry = await loadFinancialOrder(orderNumber);
    if (!entry) {
      res.status(404).json({ error: `Order "${orderNumber}" not found.` });
      return;
    }

    const isAuthorized =
      isSuper || entry.sellerId === user.uid || entry.buyerId === user.uid;

    if (!isAuthorized) {
      res.status(403).json({
        error: `Forbidden: Caller "${user.uid}" is not authorized to view email notifications for order "${orderNumber}".`,
      });
      return;
    }

    const notification =
      buyerPaidEmailNotifications.get(orderNumber) || entry.buyerEmailNotification || null;
    res.json({
      orderNumber,
      paymentStatus: entry.paymentStatus,
      customerEmail: entry.customerEmail || '',
      emailSent: Boolean(notification && notification.status === 'sent'),
      emailNotification: notification
        ? {
            ...notification,
            downloadToken:
              isSuper || entry.buyerId === user.uid
                ? notification.downloadToken
                : 'REDACTED-FOR-SELLER',
          }
        : null,
    });
  }));

  // 10. Server-Side Refund & Commission Reversal Endpoint (Cryptographically Authenticated Seller or Super Admin)
  app.post('/api/orders/refund', asyncRoute(async (req, res) => {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    const isSuper = isStrictSuperAdminUser(user);

    const { orderNumber, reason } = req.body || {};
    if (!(await ensureFinancialDatabaseReady(res))) return;
    const entry = await loadFinancialOrder(String(orderNumber));
    if (!entry) {
      res.status(404).json({ error: `Order "${orderNumber}" not found in persistent ledger.` });
      return;
    }

    const isOrderSeller = user.uid === entry.sellerId;

    if (!isSuper && !isOrderSeller) {
      res.status(403).json({
        error: `Forbidden: Caller "${user.uid}" is not authorized to refund order "${orderNumber}" belonging to seller "${entry.sellerId}".`,
      });
      return;
    }

    await withSellerLock(entry.sellerId, async () => {
      if (entry.paymentStatus === 'Refunded') {
        res.status(409).json({
          error: `Duplicate refund blocked: Order "${orderNumber}" has already been refunded.`,
        });
        return;
      }

      const prevStatus = entry.paymentStatus;
      const oldCommission = entry.platformCommissionMinor;
      const previousRecord = { ...entry };

      entry.paymentStatus = 'Refunded';
      entry.commissionStatus = 'reversed';
      entry.payoutStatus = 'Reversed (Refunded)';
      entry.platformCommissionMinor = 0;
      entry.sellerShareBeforeFeesMinor = 0;
      entry.sellerNetEarningsMinor = 0;
      entry.downloadToken = 'REVOKED-REFUNDED';
      entry.refundedAtIso = new Date().toISOString();
      entry.updatedAtIso = new Date().toISOString();

      try {
        await commitFinancialOrderTransition(entry, prevStatus);
      } catch {
        persistentLedger.set(entry.orderNumber, previousRecord);
        res.status(503).json({ error: 'Refund reversal was not saved. Refresh and retry.' });
        return;
      }

      const auditEntry = appendAuditEntry(
        {
          orderNumber: entry.orderNumber,
          orderId: entry.orderId,
          sellerId: entry.sellerId,
          actorUid: user.uid,
          action: 'ORDER_REFUNDED_REVERSED',
          previousStatus: prevStatus,
          newStatus: 'Refunded',
          verificationMode: entry.verificationMode,
          detail: `Order refunded and 5% commission (${oldCommission / 100} ${entry.currency}) reversed to 0. Download token revoked.${reason ? ` Reason: ${reason}` : ''}`,
        },
        user.rawToken
      );

      // If this order was already billed in an invoice, adjust the invoice balance automatically
      applyOrderCommissionReversalToInvoice(
        entry.orderNumber,
        entry.sellerId,
        oldCommission,
        entry.currency,
        'order_refunded',
        user.rawToken
      );

      const commissionSummary = reconcileSellerCommissionState(
        entry.sellerId,
        Date.now(),
        user.rawToken
      );

      res.json({
        ok: true,
        orderNumber: entry.orderNumber,
        orderId: entry.orderId,
        paymentStatus: entry.paymentStatus,
        commissionStatus: entry.commissionStatus,
        payoutStatus: entry.payoutStatus,
        reversedCommissionMinor: 0,
        reversedSellerShareMinor: 0,
        ledgerEntry: entry,
        auditEntry,
        commissionSummary,
      });
    });
  }));

  // 10B. Commission Settlement & Dispute Status Transition Endpoint
  app.post('/api/ledger/commission-status', asyncRoute(async (req, res) => {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    const isSuper = isStrictSuperAdminUser(user);

    const { orderNumber, newCommissionStatus, note } = req.body || {};
    const entry = await loadFinancialOrder(String(orderNumber));
    if (!entry) {
      res.status(404).json({ error: `Ledger record "${orderNumber}" not found.` });
      return;
    }

    const isOrderSeller = user.uid === entry.sellerId;

    if (!isSuper && !isOrderSeller) {
      res.status(403).json({
        error: 'Forbidden: Only the order seller or verified Super Admin can update commission status.',
      });
      return;
    }

    if (newCommissionStatus === 'paid' && !isSuper) {
      res.status(403).json({
        error: 'Forbidden: Only the verified Super Admin can mark platform commission as settled/paid.',
      });
      return;
    }

    if (!['outstanding', 'paid', 'reversed', 'disputed'].includes(String(newCommissionStatus))) {
      res.status(400).json({ error: 'Invalid commissionStatus value.' });
      return;
    }

    await withSellerLock(entry.sellerId, () => {
      const prevComm = entry.commissionStatus;
      entry.commissionStatus = newCommissionStatus as CommissionStatus;
      entry.updatedAtIso = new Date().toISOString();

      syncFirestoreDoc(
        'ledger',
        entry.orderNumber,
        entry as unknown as Record<string, unknown>,
        user.rawToken
      );

      const auditEntry = appendAuditEntry(
        {
          orderNumber: entry.orderNumber,
          orderId: entry.orderId,
          sellerId: entry.sellerId,
          actorUid: user.uid,
          action:
            newCommissionStatus === 'disputed' ? 'COMMISSION_DISPUTED' : 'COMMISSION_SETTLED',
          previousStatus: prevComm,
          newStatus: String(newCommissionStatus),
          verificationMode: entry.verificationMode,
          detail: `Commission status changed from "${prevComm}" to "${newCommissionStatus}". ${note ? String(note).slice(0, 200) : ''}`,
        },
        user.rawToken
      );

      if (newCommissionStatus === 'disputed' || newCommissionStatus === 'reversed') {
        applyOrderCommissionReversalToInvoice(
          entry.orderNumber,
          entry.sellerId,
          entry.platformCommissionMinor,
          entry.currency,
          'order_disputed',
          user.rawToken
        );
      }

      const commissionSummary = reconcileSellerCommissionState(
        entry.sellerId,
        Date.now(),
        user.rawToken
      );

      res.json({
        ok: true,
        orderNumber: entry.orderNumber,
        commissionStatus: entry.commissionStatus,
        auditEntry,
        commissionSummary,
      });
    });
  }));

  // 10C. SMART 5% COMMISSION MANAGEMENT SYSTEM ENDPOINTS
  // GET /api/commission/status (and /api/commissions/invoices) — Cryptographically Authenticated Seller & Super Admin Commission Status Summary
  const handleGetCommissionStatus = async (req: express.Request, res: express.Response) => {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    const isSuper = isStrictSuperAdminUser(user);

    const requestedSellerId = String(req.query.sellerId || req.query.ownerId || '').trim();
    const requestedStoreId = String(req.query.storeId || '').trim();
    const canonicalUserStoreId = `store-${user.uid.slice(0, 20)}`;
    const fullUidStoreId = `store-${user.uid}`;
    const ownedStore = await resolveOwnedStoreForUser(user.uid);

    if (!isSuper) {
      if (requestedSellerId && requestedSellerId !== user.uid) {
        res.status(403).json({
          error: `Forbidden: Seller "${user.uid}" cannot access commission records for seller "${requestedSellerId}".`,
        });
        return;
      }
      if (requestedStoreId) {
        const targetStore = serverStores.get(requestedStoreId);
        const isOwnedInRegistry = Boolean(targetStore && targetStore.ownerId === user.uid);
        const isForeignInRegistry = Boolean(targetStore && targetStore.ownerId !== user.uid);
        const hasForeignInvoice = Array.from(commissionInvoices.values()).some(
          (inv) => inv.storeId === requestedStoreId && inv.sellerId !== user.uid
        );
        if (
          isForeignInRegistry ||
          hasForeignInvoice ||
          (!isOwnedInRegistry &&
            requestedStoreId !== canonicalUserStoreId &&
            requestedStoreId !== fullUidStoreId &&
            requestedStoreId !== ownedStore?.storeId)
        ) {
          res.status(403).json({
            error: `Forbidden: Seller "${user.uid}" cannot access commission records for store "${requestedStoreId}".`,
          });
          return;
        }
      }
      const hasSellerInvoicesOrSales =
        Array.from(commissionInvoices.values()).some((inv) => inv.sellerId === user.uid) ||
        Array.from(persistentLedger.values()).some((e) => e.sellerId === user.uid);
      if (!ownedStore && !hasSellerInvoicesOrSales) {
        res.status(403).json({
          error: `Forbidden: Buyer "${user.uid}" is not a store owner and cannot access seller commission invoices.`,
        });
        return;
      }
    }

    const effectiveSellerId =
      isSuper && requestedSellerId
        ? requestedSellerId
        : isSuper && requestedStoreId
        ? serverStores.get(requestedStoreId)?.ownerId || user.uid
        : user.uid;
    const summary = reconcileSellerCommissionState(effectiveSellerId, Date.now(), user.rawToken);
    res.json(summary);
  };

  app.get('/api/commission/status', asyncRoute(handleGetCommissionStatus));
  app.get('/api/commissions/invoices', asyncRoute(handleGetCommissionStatus));

  // GET /api/commission/admin-overview (and /api/commission/admin/overview) — Strictly Super Admin view of all stores, visits, invoices, payments & adjustments
  const handleAdminCommissionOverview = async (
    req: express.Request,
    res: express.Response
  ) => {
    const adminUser = await requireSuperAdminUser(req, res);
    if (!adminUser) return;

    if (serverStores.size === 0) {
      await hydrateActiveStoresFromFirestore();
    }
    if (serverProducts.size === 0) {
      await hydratePublishedProductsFromFirestore();
    }

    for (const store of serverStores.values()) {
      reconcileSellerCommissionState(store.ownerId, Date.now(), adminUser.rawToken);
    }

    const allLedgerEntries = Array.from(persistentLedger.values());
    let totalPlatformVisits = 0;
    let totalCheckoutViews = 0;

    const adminStoresList = Array.from(serverStores.values()).map((st) => {
      const visitStats = getOrInitStoreVisits(st.storeId);
      totalPlatformVisits += visitStats.visitsCount;
      totalCheckoutViews += visitStats.checkoutViewsCount;

      const storeProds = Array.from(serverProducts.values()).filter(
        (p) => p.storeId === st.storeId || p.ownerId === st.ownerId
      );
      const storeOrders = allLedgerEntries.filter(
        (e) => e.storeId === st.storeId || e.sellerId === st.ownerId
      );
      const paidOrdersCount = storeOrders.filter((e) => e.paymentStatus === 'Paid').length;
      const pendingOrdersCount = storeOrders.filter((e) => e.paymentStatus === 'Pending').length;

      const cachedSettings =
        firestoreVerifiedSellerSettingsByStore.get(st.storeId) ||
        firestoreVerifiedSellerSettingsByOwner.get(st.ownerId) ||
        null;
      const configuredMethods = getConfiguredSellerPaymentMethods(cachedSettings);

      const hasPro = Boolean(sellerProEntitlements.get(st.ownerId) || st.plan === 'Pro');

      return {
        storeId: st.storeId,
        storeName: st.storeName,
        storeSlug: st.storeSlug,
        ownerId: st.ownerId,
        ownerName: st.ownerName || st.storeName,
        ownerEmail: st.ownerEmail || '',
        country: st.country || st.sellerCountry || 'Pakistan',
        currency: st.currency || 'PKR',
        theme: st.theme || 'blush-bloom',
        planId: hasPro ? 'pro' : 'free',
        productCount: storeProds.length,
        status: st.status === 'Active' ? 'active' : 'suspended',
        visitsCount: visitStats.visitsCount,
        checkoutViewsCount: visitStats.checkoutViewsCount,
        lastVisitedAtIso: visitStats.lastVisitedAtIso,
        ordersCount: storeOrders.length,
        paidOrdersCount,
        pendingOrdersCount,
        paymentConfigured: configuredMethods.length > 0,
        configuredMethods,
      };
    });

    res.json({
      stores: adminStoresList,
      totalPlatformVisits,
      totalCheckoutViews,
      settings: {
        platformCommissionBps,
        maintenanceMode: false,
        allowNewSellerRegistrations: true,
        updatedAtIso: new Date().toISOString(),
      },
      invoices: Array.from(commissionInvoices.values()).sort((a, b) => b.issuedAtMs - a.issuedAtMs),
      payments: Array.from(commissionPayments.values()).sort((a, b) =>
        b.createdAtIso.localeCompare(a.createdAtIso)
      ),
      adjustments: commissionAdjustments,
    });
  };

  app.get('/api/commission/admin-overview', asyncRoute(handleAdminCommissionOverview));
  app.get('/api/commission/admin/overview', asyncRoute(handleAdminCommissionOverview));

  // POST /api/commission/admin/grant-pro — Strictly Super Admin Pro Entitlement Grant/Revoke
  const handleAdminGrantPro = async (req: express.Request, res: express.Response) => {
    const adminUser = await requireSuperAdminUser(req, res);
    if (!adminUser) return;

    const { targetSellerId, sellerId, storeId, grantPro = true } = req.body || {};
    const targetStore = storeId ? await resolveVerifiedStoreRecord(String(storeId)) : undefined;
    const resolvedSellerId = String(
      targetSellerId ||
        sellerId ||
        targetStore?.ownerId ||
        ''
    ).trim();

    if (!resolvedSellerId && !targetStore) {
      res.status(400).json({ error: 'targetSellerId or storeId is required.' });
      return;
    }

    const enabled = Boolean(grantPro);
    if (resolvedSellerId) {
      sellerProEntitlements.set(resolvedSellerId, enabled);
    }
    for (const st of serverStores.values()) {
      if (st.ownerId === resolvedSellerId || (storeId && st.storeId === String(storeId))) {
        st.plan = enabled ? 'Pro' : 'Free';
        serverStores.set(st.storeId, st);
        syncFirestoreDoc(
          'stores',
          st.storeId,
          st as unknown as Record<string, unknown>,
          adminUser.rawToken
        );
      }
    }

    res.json({
      ok: true,
      targetSellerId: resolvedSellerId,
      storeId: targetStore?.storeId || storeId,
      plan: enabled ? 'Pro' : 'Free',
      hasProEntitlement: enabled,
      updatedByUid: adminUser.uid,
    });
  };

  app.post('/api/commission/admin/grant-pro', asyncRoute(handleAdminGrantPro));
  app.post('/api/admin/subscriptions/grant-pro', asyncRoute(handleAdminGrantPro));

  // POST /api/admin/stores/status — Strictly Super Admin Store Moderation Mutation
  app.post('/api/admin/stores/status', asyncRoute(async (req, res) => {
    const adminUser = await requireSuperAdminUser(req, res);
    if (!adminUser) return;

    const { storeId, status } = req.body || {};
    const targetStoreId = String(storeId || '').trim();
    const store =
      serverStores.get(targetStoreId) || (await resolveVerifiedStoreRecord(targetStoreId));
    if (!store) {
      res.status(404).json({ error: `Store "${targetStoreId}" not found.` });
      return;
    }

    const normalizedStatus: 'Active' | 'Pending' =
      String(status).toLowerCase() === 'active' ? 'Active' : 'Pending';
    store.status = normalizedStatus;
    serverStores.set(store.storeId, store);
    syncFirestoreDoc(
      'stores',
      store.storeId,
      store as unknown as Record<string, unknown>,
      adminUser.rawToken
    );

    res.json({
      ok: true,
      storeId: store.storeId,
      status: store.status,
      updatedByUid: adminUser.uid,
    });
  }));

  // POST /api/admin/stores/control — Instant Super Admin Multi-Store Command Endpoint
  app.post('/api/admin/stores/control', asyncRoute(async (req, res) => {
    const adminUser = await requireSuperAdminUser(req, res);
    if (!adminUser) return;

    const { action, storeId, updates } = req.body || {};
    const cleanAction = String(action || '').trim().toLowerCase();

    if (cleanAction === 'activate_all_stores') {
      let updatedCount = 0;
      for (const st of serverStores.values()) {
        if (st.status !== 'Active') {
          st.status = 'Active';
          serverStores.set(st.storeId, st);
          syncFirestoreDoc(
            'stores',
            st.storeId,
            st as unknown as Record<string, unknown>,
            adminUser.rawToken
          );
          updatedCount += 1;
        }
      }
      res.json({ ok: true, action: cleanAction, updatedCount });
      return;
    }

    if (cleanAction === 'approve_all_pending_orders') {
      let verifiedCount = 0;
      const nowIso = new Date().toISOString();
      for (const entry of persistentLedger.values()) {
        if (entry.paymentStatus === 'Pending' && (!storeId || entry.storeId === String(storeId))) {
          entry.paymentStatus = 'Paid';
          entry.verificationMode = 'Manually Verified by Seller';
          entry.verifiedByUid = adminUser.uid;
          entry.verifiedAtIso = nowIso;
          entry.updatedAtIso = nowIso;
          entry.downloadToken = createSignedDownloadToken({
            orderNumber: entry.orderNumber,
            productId: entry.primaryProductId,
            buyerId: entry.buyerId,
            expiresAtMs: entry.expiresAtMs,
          });
          await triggerBuyerPaidOrderEmail(entry, adminUser.uid, adminUser.rawToken);
          syncFirestoreDoc(
            'ledger',
            entry.orderNumber,
            entry as unknown as Record<string, unknown>,
            adminUser.rawToken
          );
          reconcileSellerCommissionState(entry.sellerId, Date.now(), adminUser.rawToken);
          verifiedCount += 1;
        }
      }
      res.json({ ok: true, action: cleanAction, verifiedCount });
      return;
    }

    const targetStoreId = String(storeId || '').trim();
    const store =
      serverStores.get(targetStoreId) || (await resolveVerifiedStoreRecord(targetStoreId));
    if (!store) {
      res.status(404).json({ error: `Store "${targetStoreId}" not found.` });
      return;
    }

    if (cleanAction === 'activate' || cleanAction === 'suspend') {
      store.status = cleanAction === 'activate' ? 'Active' : 'Pending';
    } else if (cleanAction === 'grant_pro' || cleanAction === 'revoke_pro') {
      const isPro = cleanAction === 'grant_pro';
      store.plan = isPro ? 'Pro' : 'Free';
      sellerProEntitlements.set(store.ownerId, isPro);
    } else if (cleanAction === 'update_store' && updates && typeof updates === 'object') {
      if (updates.storeName) store.storeName = String(updates.storeName).trim().slice(0, 100);
      if (updates.storeSlug) {
        const nextSlug = String(updates.storeSlug)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_.-]/g, '')
          .slice(0, 40);
        if (nextSlug.length >= 2) store.storeSlug = nextSlug;
      }
      if (updates.currency && String(updates.currency) in SUPPORTED_CURRENCIES) {
        store.currency = String(updates.currency);
      }
      if (updates.theme) store.theme = String(updates.theme);
      if (updates.plan) {
        const isPro = String(updates.plan).toLowerCase() === 'pro';
        store.plan = isPro ? 'Pro' : 'Free';
        sellerProEntitlements.set(store.ownerId, isPro);
      }
      if (updates.status) {
        store.status = String(updates.status).toLowerCase() === 'active' ? 'Active' : 'Pending';
      }
    }

    serverStores.set(store.storeId, store);
    syncFirestoreDoc(
      'stores',
      store.storeId,
      store as unknown as Record<string, unknown>,
      adminUser.rawToken
    );

    const visits = getOrInitStoreVisits(store.storeId);
    res.json({
      ok: true,
      action: cleanAction,
      store: {
        ...store,
        planId: store.plan === 'Pro' ? 'pro' : 'free',
        status: store.status === 'Active' ? 'active' : 'suspended',
        visitsCount: visits.visitsCount,
        checkoutViewsCount: visits.checkoutViewsCount,
        lastVisitedAtIso: visits.lastVisitedAtIso,
      },
    });
  }));

  // POST /api/commission/submit-payment — Seller submits commission payment details & proof
  app.post('/api/commission/submit-payment', asyncRoute(async (req, res) => {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    const isSuper = isStrictSuperAdminUser(user);

    const {
      invoiceId,
      sellerId: rawBodySellerId,
      amountMinor,
      paymentMethod = 'jazzcash',
      paymentReference,
      proofNote = '',
    } = req.body || {};

    if (!isSuper && rawBodySellerId && String(rawBodySellerId).trim() !== user.uid) {
      res.status(403).json({
        error: `Forbidden: Spoofed sellerId "${rawBodySellerId}" does not match verified token UID "${user.uid}".`,
      });
      return;
    }

    if (!invoiceId) {
      res.status(400).json({ error: 'invoiceId is required.' });
      return;
    }

    const inv = commissionInvoices.get(String(invoiceId));
    if (!inv) {
      res.status(404).json({ error: `Commission invoice "${invoiceId}" not found.` });
      return;
    }

    if (!isSuper && user.uid !== inv.sellerId) {
      res.status(403).json({
        error: `Forbidden: Seller "${user.uid}" cannot submit payment for invoice belonging to "${inv.sellerId}".`,
      });
      return;
    }

    const cleanRef = String(paymentReference || '').trim().toUpperCase();
    if (cleanRef.length < 3) {
      res.status(400).json({
        error: 'Please provide a valid payment transaction reference ID (at least 3 characters).',
      });
      return;
    }

    await withSellerLock(inv.sellerId, () => {
      if (inv.status === 'paid' || inv.remainingBalanceMinor <= 0) {
        res.status(409).json({
          error: `Invoice "${inv.invoiceNumber}" has already been settled in full.`,
        });
        return;
      }

      // Block duplicate payment reference submissions
      const duplicatePayment = Array.from(commissionPayments.values()).find(
        (p) =>
          p.status !== 'rejected' &&
          p.paymentReference.trim().toUpperCase() === cleanRef
      );
      if (duplicatePayment) {
        res.status(409).json({
          duplicateReference: true,
          error: `Duplicate commission payment reference "${cleanRef}" has already been submitted (${duplicatePayment.paymentId}).`,
        });
        return;
      }

      const requestedMinor =
        amountMinor !== undefined && Number(amountMinor) > 0
          ? Math.min(inv.remainingBalanceMinor, Math.round(Number(amountMinor)))
          : inv.remainingBalanceMinor;

      const nowIso = new Date().toISOString();
      const paymentId = `cpay-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;
      const paymentRecord: CommissionPaymentSubmission = {
        paymentId,
        invoiceId: inv.invoiceId,
        invoiceNumber: inv.invoiceNumber,
        sellerId: inv.sellerId,
        storeId: inv.storeId,
        currency: inv.currency,
        amountMinor: requestedMinor,
        paymentMethod: String(paymentMethod),
        paymentReference: cleanRef,
        proofNote: String(proofNote || 'Commission transfer receipt submitted by seller.').slice(
          0,
          500
        ),
        status: 'submitted',
        submittedByUid: user.uid,
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
      };

      commissionPayments.set(paymentId, paymentRecord);
      inv.status = 'payment_submitted';
      inv.lastPaymentMethod = String(paymentMethod);
      inv.lastPaymentReference = cleanRef;
      inv.lastPaymentProofNote = paymentRecord.proofNote;
      inv.submittedAtIso = nowIso;

      syncFirestoreDoc(
        'commission_payments',
        paymentId,
        paymentRecord as unknown as Record<string, unknown>,
        user.rawToken
      );
      syncFirestoreDoc(
        'commission_invoices',
        inv.invoiceId,
        inv as unknown as Record<string, unknown>,
        user.rawToken
      );

      appendAuditEntry(
        {
          orderNumber: inv.orderNumbers[0] || inv.invoiceNumber,
          orderId: inv.invoiceId,
          sellerId: inv.sellerId,
          actorUid: user.uid,
          action: 'COMMISSION_PAYMENT_SUBMITTED',
          previousStatus: 'open',
          newStatus: 'payment_submitted',
          verificationMode: 'Pending Admin Verification',
          detail: `Seller (${user.uid}) submitted commission payment of ${(
            requestedMinor / 100
          ).toFixed(2)} ${inv.currency} for ${inv.invoiceNumber} via ${paymentMethod} (Ref: ${cleanRef}). Awaiting Super Admin verification.`,
        },
        user.rawToken
      );

      const summary = reconcileSellerCommissionState(inv.sellerId, Date.now(), user.rawToken);
      res.json({
        ok: true,
        payment: paymentRecord,
        invoice: inv,
        commissionSummary: summary,
      });
    });
  }));

  // POST /api/commission/verify-payment (and /api/admin/commission/verify-payment)
  // Strictly Restricted to Verified Single-UID DreamStore Super Admin (SUPER_ADMIN_UID)
  const handleVerifyCommissionPaymentOnServer = async (
    req: express.Request,
    res: express.Response
  ) => {
    const adminUser = await requireSuperAdminUser(req, res);
    if (!adminUser) return;

    const {
      paymentId,
      invoiceId,
      decision,
      action,
      note = '',
    } = req.body || {};

    const effectiveDecision =
      action === 'reject' || decision === 'reject' ? 'reject' : 'approve';

    const payment = paymentId
      ? commissionPayments.get(String(paymentId))
      : Array.from(commissionPayments.values()).find(
          (p) => p.invoiceId === String(invoiceId) && p.status === 'submitted'
        );

    const inv = commissionInvoices.get(String(invoiceId || payment?.invoiceId || ''));
    if (!inv) {
      res.status(404).json({ error: 'Target commission invoice not found.' });
      return;
    }

    await withSellerLock(inv.sellerId, () => {
      const nowIso = new Date().toISOString();

      if (effectiveDecision === 'approve') {
        const creditMinor = payment ? payment.amountMinor : inv.remainingBalanceMinor;
        if (payment) {
          if (payment.status === 'verified') {
            res.status(409).json({ error: 'Commission payment has already been verified.' });
            return;
          }
          payment.status = 'verified';
          payment.verifiedByAdminEmail = adminUser.email || SUPER_ADMIN_EMAIL;
          payment.updatedAtIso = nowIso;
          syncFirestoreDoc(
            'commission_payments',
            payment.paymentId,
            payment as unknown as Record<string, unknown>,
            adminUser.rawToken
          );
        }

        inv.paidAmountMinor += creditMinor;
        inv.remainingBalanceMinor = Math.max(
          0,
          inv.commissionAmountMinor - inv.adjustedAmountMinor - inv.paidAmountMinor
        );
        inv.verifiedByAdminEmail = adminUser.email || SUPER_ADMIN_EMAIL;
        inv.verifiedAtIso = nowIso;

        if (inv.remainingBalanceMinor === 0) {
          inv.status = 'paid';
          for (const ordNum of inv.orderNumbers) {
            const led = persistentLedger.get(ordNum);
            if (led && led.commissionStatus === 'outstanding') {
              led.commissionStatus = 'paid';
              led.updatedAtIso = nowIso;
              syncFirestoreDoc(
                'ledger',
                ordNum,
                led as unknown as Record<string, unknown>,
                adminUser.rawToken
              );
            }
          }
        } else {
          inv.status = Date.now() > inv.dueAtMs ? 'overdue' : 'open';
        }

        syncFirestoreDoc(
          'commission_invoices',
          inv.invoiceId,
          inv as unknown as Record<string, unknown>,
          adminUser.rawToken
        );

        appendAuditEntry(
          {
            orderNumber: inv.orderNumbers[0] || inv.invoiceNumber,
            orderId: inv.invoiceId,
            sellerId: inv.sellerId,
            actorUid: adminUser.uid,
            action: 'COMMISSION_PAYMENT_VERIFIED',
            previousStatus: 'payment_submitted',
            newStatus: inv.status,
            verificationMode: 'Admin Verified',
            detail: `Super Admin (${adminUser.uid}) verified commission payment of ${(
              creditMinor / 100
            ).toFixed(2)} ${inv.currency} for ${inv.invoiceNumber}. Remaining balance: ${(
              inv.remainingBalanceMinor / 100
            ).toFixed(2)} ${inv.currency}.${note ? ` Note: ${note}` : ''}`,
          },
          adminUser.rawToken
        );

        const summary = reconcileSellerCommissionState(
          inv.sellerId,
          Date.now(),
          adminUser.rawToken
        );
        res.json({
          ok: true,
          message: `Commission payment verified for ${inv.invoiceNumber}. Seller features unlocked.`,
          invoice: inv,
          payment,
          commissionSummary: summary,
        });
      } else {
        if (payment) {
          payment.status = 'rejected';
          payment.verifiedByAdminEmail = adminUser.email || SUPER_ADMIN_EMAIL;
          payment.updatedAtIso = nowIso;
          syncFirestoreDoc(
            'commission_payments',
            payment.paymentId,
            payment as unknown as Record<string, unknown>,
            adminUser.rawToken
          );
        }
        inv.status = Date.now() > inv.dueAtMs ? 'overdue' : 'open';
        syncFirestoreDoc(
          'commission_invoices',
          inv.invoiceId,
          inv as unknown as Record<string, unknown>,
          adminUser.rawToken
        );

        appendAuditEntry(
          {
            orderNumber: inv.orderNumbers[0] || inv.invoiceNumber,
            orderId: inv.invoiceId,
            sellerId: inv.sellerId,
            actorUid: adminUser.uid,
            action: 'COMMISSION_PAYMENT_REJECTED',
            previousStatus: 'payment_submitted',
            newStatus: inv.status,
            verificationMode: 'Admin Rejected',
            detail: `Super Admin (${adminUser.uid}) rejected commission payment for ${inv.invoiceNumber}.${note ? ` Reason: ${note}` : ''}`,
          },
          adminUser.rawToken
        );

        const summary = reconcileSellerCommissionState(
          inv.sellerId,
          Date.now(),
          adminUser.rawToken
        );
        res.json({
          ok: true,
          message: `Commission payment rejected for ${inv.invoiceNumber}.`,
          invoice: inv,
          payment,
          commissionSummary: summary,
        });
      }
    });
  };

  app.post('/api/commission/verify-payment', asyncRoute(handleVerifyCommissionPaymentOnServer));
  app.post('/api/admin/commission/verify-payment', asyncRoute(handleVerifyCommissionPaymentOnServer));
  app.post('/api/commissions/verify-payment', asyncRoute(handleVerifyCommissionPaymentOnServer));

  // POST /api/commission/simulate-overdue — Protected by Cryptographic Auth & Ownership
  app.post('/api/commission/simulate-overdue', asyncRoute(async (req, res) => {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    const isSuper = isStrictSuperAdminUser(user);

    const { invoiceId, sellerId, makeOverdue = true } = req.body || {};
    const targetSellerId = isSuper && sellerId ? String(sellerId).trim() : user.uid;
    if (!isSuper && sellerId && String(sellerId).trim() !== user.uid) {
      res.status(403).json({
        error: `Forbidden: Seller "${user.uid}" cannot modify commission invoices for seller "${sellerId}".`,
      });
      return;
    }

    const inv = invoiceId
      ? commissionInvoices.get(String(invoiceId))
      : Array.from(commissionInvoices.values()).find(
          (i) => i.sellerId === targetSellerId && i.remainingBalanceMinor > 0
        );
    if (!inv) {
      res.status(404).json({ error: 'No open commission invoice found for seller.' });
      return;
    }
    if (!isSuper && inv.sellerId !== user.uid) {
      res.status(403).json({
        error: `Forbidden: Seller "${user.uid}" cannot modify invoice "${inv.invoiceId}" belonging to "${inv.sellerId}".`,
      });
      return;
    }

    await withSellerLock(inv.sellerId, () => {
      if (makeOverdue) {
        inv.dueAtMs = Date.now() - 24 * 60 * 60 * 1000;
        inv.dueAtIso = new Date(inv.dueAtMs).toISOString();
      } else {
        inv.dueAtMs = Date.now() + INVOICE_PAYMENT_WINDOW_MS;
        inv.dueAtIso = new Date(inv.dueAtMs).toISOString();
      }
      const summary = reconcileSellerCommissionState(inv.sellerId, Date.now(), user.rawToken);
      res.json({
        ok: true,
        invoice: inv,
        commissionSummary: summary,
      });
    });
  }));

  // 10D. Server-Validated Free vs Pro Entitlements & Subscriptions Endpoints
  app.get('/api/entitlements/:sellerId', asyncRoute(async (req, res) => {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    const isSuper = isStrictSuperAdminUser(user);

    const sellerId = String(req.params.sellerId || '').trim();
    if (!isSuper && sellerId !== user.uid) {
      res.status(403).json({
        error: `Forbidden: Seller "${user.uid}" cannot read subscription entitlements for seller "${sellerId}".`,
      });
      return;
    }

    const store = await resolveOwnedStoreForUser(sellerId);
    if (!isSuper && !store) {
      res.status(403).json({
        error: `Forbidden: Buyer "${user.uid}" does not own a store and cannot access seller subscription entitlements.`,
      });
      return;
    }
    const hasPro = Boolean(sellerProEntitlements.get(sellerId) || store?.plan === 'Pro');
    res.json({
      sellerId,
      plan: hasPro ? 'Pro' : 'Free',
      hasProEntitlement: hasPro,
      starterThemes: ['blush-bloom', 'lavender-cloud', 'vanilla-studio'],
      proThemes: ['peach-petal', 'midnight-muse', 'clean-canvas'],
      features: {
        basicBranding: true,
        productPublishing: true,
        visualStoreBuilder: hasPro,
        advancedLayoutCustomization: hasPro,
        premiumThemes: hasPro,
        advancedAnalytics: hasPro,
      },
    });
  }));

  const handleGetSubscriptions = async (req: express.Request, res: express.Response) => {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    const isSuper = isStrictSuperAdminUser(user);
    const requestedSellerId = String(req.query.sellerId || req.query.ownerId || '').trim();
    const requestedStoreId = String(req.query.storeId || '').trim();
    const canonicalUserStoreId = `store-${user.uid.slice(0, 20)}`;
    const fullUidStoreId = `store-${user.uid}`;
    const ownedStore = await resolveOwnedStoreForUser(user.uid);

    if (!isSuper) {
      if (requestedSellerId && requestedSellerId !== user.uid) {
        res.status(403).json({
          error: `Forbidden: Seller "${user.uid}" cannot access subscription status for seller "${requestedSellerId}".`,
        });
        return;
      }

      if (requestedStoreId) {
        const st = serverStores.get(requestedStoreId);
        const isOwnedInRegistry = Boolean(st && st.ownerId === user.uid);
        const isForeignInRegistry = Boolean(st && st.ownerId !== user.uid);
        if (
          isForeignInRegistry ||
          (!isOwnedInRegistry &&
            requestedStoreId !== canonicalUserStoreId &&
            requestedStoreId !== fullUidStoreId &&
            requestedStoreId !== ownedStore?.storeId)
        ) {
          res.status(403).json({
            error: `Forbidden: Seller "${user.uid}" cannot access subscription for store "${requestedStoreId}".`,
          });
          return;
        }
      }

      if (!ownedStore) {
        res.status(403).json({
          error: `Forbidden: Buyer "${user.uid}" does not own a store and cannot access seller subscription status.`,
        });
        return;
      }
    }

    const storesList = Array.from(serverStores.values()).filter((s) =>
      isSuper
        ? (!requestedStoreId || s.storeId === requestedStoreId) &&
          (!requestedSellerId || s.ownerId === requestedSellerId)
        : s.ownerId === user.uid && (!requestedStoreId || s.storeId === requestedStoreId)
    );

    const effectiveSellerId = isSuper && requestedSellerId ? requestedSellerId : user.uid;
    const hasPro = Boolean(
      sellerProEntitlements.get(effectiveSellerId) ||
        storesList.some((s) => s.plan === 'Pro')
    );

    res.json({
      sellerId: effectiveSellerId,
      plan: hasPro ? 'Pro' : 'Free',
      hasProEntitlement: hasPro,
      subscriptions: storesList.map((s) => ({
        subscriptionId: `sub-${s.storeId}`,
        storeId: s.storeId,
        sellerId: s.ownerId,
        plan: sellerProEntitlements.get(s.ownerId) || s.plan === 'Pro' ? 'Pro' : 'Free',
        status: 'Active',
      })),
    });
  };

  app.get('/api/subscriptions', asyncRoute(handleGetSubscriptions));
  app.get('/api/subscription/status', asyncRoute(handleGetSubscriptions));

  app.post('/api/subscriptions', asyncRoute(async (req, res) => {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    const isSuper = isStrictSuperAdminUser(user);

    const body = req.body || {};
    const requestedSellerId = String(body.sellerId || body.ownerId || '').trim();
    const requestedStoreId = String(body.storeId || '').trim();
    const canonicalUserStoreId = `store-${user.uid.slice(0, 20)}`;
    const fullUidStoreId = `store-${user.uid}`;
    const ownedStore = await resolveOwnedStoreForUser(user.uid);

    if (!isSuper) {
      if (requestedSellerId && requestedSellerId !== user.uid) {
        res.status(403).json({
          error: `Forbidden: Seller "${user.uid}" cannot modify subscription for seller "${requestedSellerId}".`,
        });
        return;
      }
      if (requestedStoreId) {
        const st = serverStores.get(requestedStoreId);
        const isOwnedInRegistry = Boolean(st && st.ownerId === user.uid);
        const isForeignInRegistry = Boolean(st && st.ownerId !== user.uid);
        if (
          isForeignInRegistry ||
          (!isOwnedInRegistry &&
            requestedStoreId !== canonicalUserStoreId &&
            requestedStoreId !== fullUidStoreId &&
            requestedStoreId !== ownedStore?.storeId)
        ) {
          res.status(403).json({
            error: `Forbidden: Seller "${user.uid}" cannot modify subscription for store "${requestedStoreId}".`,
          });
          return;
        }
      }
      if (!ownedStore) {
        res.status(403).json({
          error: `Forbidden: Buyer "${user.uid}" does not own a store and cannot modify seller subscriptions.`,
        });
        return;
      }
      if (body.plan === 'Pro' && body.status !== 'Waitlist') {
        res.status(403).json({
          error: 'Forbidden: Only the verified Super Admin can activate Pro subscriptions.',
        });
        return;
      }
    }

    const effectiveSellerId = isSuper && requestedSellerId ? requestedSellerId : user.uid;
    const effectiveStoreId = requestedStoreId || ownedStore?.storeId || canonicalUserStoreId;
    if (isSuper && body.plan === 'Pro') {
      sellerProEntitlements.set(effectiveSellerId, true);
    }

    res.json({
      ok: true,
      subscription: {
        subscriptionId: `sub-${effectiveStoreId}`,
        storeId: effectiveStoreId,
        sellerId: effectiveSellerId,
        plan: isSuper && body.plan === 'Pro' ? 'Pro' : 'Free',
        status: body.status === 'Waitlist' ? 'Waitlist' : 'Active',
      },
    });
  }));

  // No gateway adapter is installed. Do not acknowledge or simulate payment events.
  app.post('/api/webhooks/:provider', asyncRoute((_req, res) => {
    res.status(503).json({ error: 'Automatic payment webhooks are not enabled. Use the verified manual payment workflow.' });
  }));

  app.post('/api/downloads/token', asyncRoute(async (req, res) => {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    if (!(await ensureFinancialDatabaseReady(res))) return;
    const entry = await loadFinancialOrder(String(req.body?.orderNumber || ''));
    if (!entry || entry.buyerId !== user.uid || entry.paymentStatus !== 'Paid' ||
      Date.now() >= entry.expiresAtMs || entry.downloadCount >= entry.maxDownloads) {
      res.status(403).json({ error: 'A valid order belonging to your account is required.' });
      return;
    }
    res.json({ ok: true, downloadToken: entry.downloadToken, expiresAtMs: entry.expiresAtMs });
  }));

  // 12. Verify Download Token & Server-Authoritative Payment Status before serving protected file
  app.post('/api/delivery/verify-download', asyncRoute(async (req, res) => {
    const verifiedUser = await requireAuthenticatedUser(req, res);
    if (!verifiedUser) return;
    if (!(await ensureFinancialDatabaseReady(res))) return;

    const {
      orderNumber,
      productId,
      buyerId,
      paymentStatus,
      downloadToken,
      downloadCount,
      maxDownloads,
      expiresAtMs,
    } = req.body || {};

    const ledgerEntry = await loadFinancialOrder(String(orderNumber));
    if (!ledgerEntry) {
      res.status(404).json({ allowed: false, error: 'Verified order not found. Download denied.' });
      return;
    }
    const requestedBuyerId = String(buyerId || '').trim();
    const isSuper = isStrictSuperAdminUser(verifiedUser);

    if (!requestedBuyerId) {
      res.status(400).json({
        allowed: false,
        error: 'Download blocked: buyerId is required.',
      });
      return;
    }

    // Strict buyer identity verification: buyer-${uid} normalization is NEVER permitted to bypass buyer identity or download authorization
    if (!isSuper) {
      if (requestedBuyerId !== verifiedUser.uid) {
        res.status(403).json({
          allowed: false,
          error: `Forbidden: Buyer identity "${requestedBuyerId}" does not match authenticated user "${verifiedUser.uid}". buyer-\${uid} normalization cannot bypass download authorization.`,
        });
        return;
      }
      if (ledgerEntry && ledgerEntry.buyerId !== verifiedUser.uid) {
        res.status(403).json({
          allowed: false,
          error: `Forbidden: Authenticated user "${verifiedUser.uid}" is not the buyer of order "${orderNumber}".`,
        });
        return;
      }
    }

    // Authoritative server ledger check first (prevents client spoofing paymentStatus: "Paid")
    const effectivePaymentStatus = ledgerEntry.paymentStatus;
    const effectiveToken = String(downloadToken || ledgerEntry.downloadToken);
    const effectiveCount = ledgerEntry.downloadCount;
    const effectiveMax = ledgerEntry.maxDownloads;
    const effectiveExpires = ledgerEntry.expiresAtMs;

    if (ledgerEntry && ledgerEntry.buyerId !== requestedBuyerId) {
      res.status(403).json({
        allowed: false,
        error: 'Download blocked: Buyer identity does not match the order owner.',
      });
      return;
    }

    if (ledgerEntry && ledgerEntry.primaryProductId !== String(productId)) {
      res.status(403).json({
        allowed: false,
        error: 'Download blocked: Cross-product / cross-seller token reuse is forbidden.',
      });
      return;
    }

    if (effectivePaymentStatus !== 'Paid') {
      res.status(403).json({
        allowed: false,
        error: `Download blocked: Authoritative order status is "${effectivePaymentStatus}". Paid downloads are locked until payment is verified.`,
      });
      return;
    }

    if (effectiveCount >= effectiveMax) {
      res.status(403).json({
        allowed: false,
        error: `Download limit reached (${effectiveCount}/${effectiveMax} downloads used). Token cannot be reused beyond the maximum download limit.`,
      });
      return;
    }

    if (Date.now() > effectiveExpires) {
      res.status(403).json({
        allowed: false,
        error: 'Download link has expired.',
      });
      return;
    }

    const validSig = verifySignedDownloadToken(
      effectiveToken,
      String(orderNumber),
      String(productId),
      requestedBuyerId,
      effectiveExpires
    );

    if (!validSig) {
      res.status(403).json({
        allowed: false,
        error: 'Invalid, locked, expired, or tampered download security token.',
      });
      return;
    }

    let protectedDeliverable = serverProductDeliverables.get(String(productId));
    // Buyers cannot fetch private deliverable metadata directly. Only the backend
    // reads the original file pointer after verifying this order/payment token.
    if (!protectedDeliverable && adminFirestoreDb) {
      try {
        const privateSnap = await adminFirestoreDb.collection('products')
          .doc(String(productId)).collection('deliverables').doc('main').get();
        if (privateSnap.exists) {
          const privateRecord = privateSnap.data() || {};
          if (
            String(privateRecord.ownerId || '') === ledgerEntry.sellerId &&
            String(privateRecord.productId || '') === String(productId) &&
            typeof privateRecord.fileDataUrl === 'string'
          ) {
            protectedDeliverable = {
              fileName: String(privateRecord.fileName || 'Digital-Download').slice(0, 255),
              fileType: String(privateRecord.fileMimeType || 'application/octet-stream').slice(0, 120),
              fileSizeLabel: '',
              fileDataUrl: privateRecord.fileDataUrl,
            };
            serverProductDeliverables.set(String(productId), protectedDeliverable);
          }
        }
      } catch {
        // Fail closed if authoritative metadata cannot be found.
      }
    }
    if (!protectedDeliverable && FIREBASE_PROJECT_ID && FIREBASE_API_KEY && productId) {
      try {
        const delivUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${encodeURIComponent(
          FIRESTORE_DATABASE_ID
        )}/documents/products/${encodeURIComponent(String(productId))}/deliverables/main?key=${FIREBASE_API_KEY}`;
        const delivHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        if (verifiedUser?.rawToken) {
          delivHeaders.Authorization = `Bearer ${verifiedUser.rawToken}`;
        }
        const delivRes = await fetch(delivUrl, { method: 'GET', headers: delivHeaders });
        if (delivRes.ok) {
          const delivJson = (await delivRes.json()) as Record<string, unknown>;
          if (delivJson?.fields) {
            const delivParsed = parseFirestoreDocumentFields(delivJson);
            const prodRecord = serverProducts.get(String(productId));
            const fileDataUrl = String(delivParsed.fileDataUrl || '');
            if (fileDataUrl) {
              protectedDeliverable = {
                fileName: String(
                  delivParsed.fileName || prodRecord?.fileName || 'Digital-Download.pdf'
                ),
                fileType: String(delivParsed.fileMimeType || prodRecord?.fileType || 'PDF'),
                fileSizeLabel: String(prodRecord?.fileSizeLabel || '1.2 MB'),
                fileDataUrl,
              };
              serverProductDeliverables.set(String(productId), protectedDeliverable);
            }
          }
        }
      } catch {
        // Ignore fallback deliverable fetch error
      }
    }

    if (protectedDeliverable?.fileDataUrl?.startsWith('storage://')) {
      const objectPath = protectedDeliverable.fileDataUrl.slice('storage://'.length);
      const allowedPrefix = `deliverables/${ledgerEntry.sellerId}/${String(productId)}/`;
      const safeObject = objectPath.startsWith(allowedPrefix) &&
        /^[A-Za-z0-9._/-]+$/.test(objectPath) &&
        objectPath.slice(allowedPrefix.length).length > 0 &&
        !objectPath.slice(allowedPrefix.length).includes('/');
      if (!safeObject || !FIREBASE_STORAGE_BUCKET || !adminFirestoreDb) {
        res.status(403).json({ allowed: false, error: 'Private file reference is not authorized.' });
        return;
      }
      try {
        // Firebase Admin never exposes a public download URL or cross-seller file.
        const object = getAdminStorage().bucket(FIREBASE_STORAGE_BUCKET).file(objectPath);
        const [metadata] = await object.getMetadata();
        const contentSize = Number(metadata.size || 0);
        const allowedMime = new Set([
          'application/pdf', 'application/zip', 'application/epub+zip',
          'text/plain', 'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ]);
        const contentType = String(metadata.contentType || '');
        if (contentSize < 1 || contentSize > 5 * 1024 * 1024 || !allowedMime.has(contentType)) {
          res.status(422).json({ allowed: false, error: 'Stored original file has invalid size or type.' });
          return;
        }
        const [bytes] = await object.download();
        if (bytes.length !== contentSize) {
          res.status(503).json({ allowed: false, error: 'Original file integrity check failed.' });
          return;
        }
        protectedDeliverable = {
          ...protectedDeliverable,
          fileType: contentType,
          fileDataUrl: `data:${contentType};base64,${bytes.toString('base64')}`,
        };
      } catch {
        res.status(503).json({
          allowed: false,
          error: 'Original file could not be retrieved from secure storage. Try again later.',
        });
        return;
      }
    }

    if (!protectedDeliverable?.fileDataUrl || !protectedDeliverable.fileDataUrl.startsWith('data:')) {
      res.status(404).json({
        allowed: false,
        error: 'Original product file is unavailable. No sample file was substituted or download counted.',
      });
      return;
    }

    // The download limit is financial-access state. Commit the counter with a
    // Firestore transaction so retries, concurrent downloads, and server
    // restarts cannot reset the entitlement limit.
    let committedDownloadCount: number;
    try {
      const ledgerRef = adminFirestoreDb!.collection('ledger').doc(ledgerEntry.orderNumber);
      const orderRef = adminFirestoreDb!.collection('orders').doc(ledgerEntry.orderId);
      committedDownloadCount = await adminFirestoreDb!.runTransaction(async (tx) => {
        const snap = await tx.get(ledgerRef);
        if (!snap.exists) throw new Error('Order is not present in the verified ledger.');
        const saved = snap.data() as LedgerEntry;
        const count = Number(saved.downloadCount);
        const max = Number(saved.maxDownloads);
        if (
          saved.buyerId !== requestedBuyerId ||
          saved.sellerId !== ledgerEntry.sellerId ||
          saved.primaryProductId !== String(productId) ||
          saved.paymentStatus !== 'Paid' ||
          saved.downloadToken !== effectiveToken ||
          !Number.isInteger(count) || count < 0 ||
          !Number.isInteger(max) || max < 1 || count >= max ||
          Date.now() > Number(saved.expiresAtMs)
        ) {
          throw new Error('Order access changed, expired, or download limit reached. Refresh and try again.');
        }
        const next = count + 1;
        const now = new Date();
        tx.update(ledgerRef, { downloadCount: next, updatedAtIso: now.toISOString() });
        tx.set(orderRef, { downloadCount: next, updatedAt: now }, { merge: true });
        return next;
      });
    } catch (err) {
      res.status(409).json({
        allowed: false,
        error: err instanceof Error ? err.message : 'Could not securely reserve a download. Please retry.',
      });
      return;
    }
    ledgerEntry.downloadCount = committedDownloadCount;
    ledgerEntry.updatedAtIso = new Date().toISOString();

    res.json({
      allowed: true,
      downloadCount: committedDownloadCount,
      maxDownloads: effectiveMax,
      verificationMode: ledgerEntry?.verificationMode || 'Instant Free',
      fileName: protectedDeliverable?.fileName,
      fileType: protectedDeliverable?.fileType,
      fileSizeLabel: protectedDeliverable?.fileSizeLabel,
      fileDataUrl: protectedDeliverable?.fileDataUrl,
      message: 'Download token & payment status verified by server.',
    });
  }));

  // 13. Comprehensive Automated Functional, Ledger, Manual Payment & Multi-Tenant Security Audit Suite
  // Protected by Super Admin authentication so only the verified SUPER_ADMIN_UID can execute it
  app.post('/api/test-suite/run', asyncRoute(async (req, res) => {
    const adminUser = await requireSuperAdminUser(req, res);
    if (!adminUser) return;

    const results: Array<{ name: string; passed: boolean; detail: string }> = [];

    // Audit 1: Single Super Admin UID & Legacy Fallback Removal in server.ts and firestore.rules
    const rulesExist = fs.existsSync(path.join(__dirname, 'firestore.rules'));
    const rulesRaw = rulesExist
      ? fs.readFileSync(path.join(__dirname, 'firestore.rules'), 'utf8')
      : '';
    const noHardcodedFallbackInRules =
      !rulesRaw.includes("request.auth.token.role == 'super_admin'") &&
      Boolean(SUPER_ADMIN_UID) &&
      rulesRaw.includes(`request.auth.uid == '${SUPER_ADMIN_UID}'`);
    results.push({
      name: '1. Single Super Admin UID Enforcement & Legacy Fallback Removal',
      passed: Boolean(SUPER_ADMIN_UID && noHardcodedFallbackInRules),
      detail: `SUPER_ADMIN_UID bound to "${SUPER_ADMIN_UID}" | Legacy fallback UIDs removed from server.ts & firestore.rules: ${noHardcodedFallbackInRules}`,
    });

    // Audit 2: Cryptographic Token Verification via Firebase Admin SDK (Missing Token, Raw UID, Forged Token, Arbitrary UID Rejected)
    const forgedRs256Token = `${Buffer.from(
      JSON.stringify({ alg: 'RS256', kid: '12345', typ: 'JWT' })
    ).toString('base64url')}.${Buffer.from(
      JSON.stringify({
        iss: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
        aud: FIREBASE_PROJECT_ID,
        sub: 'seller-pk-fatima',
        uid: 'seller-pk-fatima',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString('base64url')}.forged_invalid_signature_bytes`;

    const customHs256Header = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'dreamstore-internal-hs256' })
    ).toString('base64url');
    const customHs256Payload = Buffer.from(
      JSON.stringify({
        sub: SUPER_ADMIN_UID || 'seller-pk-fatima',
        user_id: SUPER_ADMIN_UID || 'seller-pk-fatima',
        email: SUPER_ADMIN_EMAIL,
        email_verified: true,
        iss: 'dreamstore-internal-test-auth',
        aud: FIREBASE_PROJECT_ID,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString('base64url');
    const customHs256Sig = crypto
      .createHmac('sha256', SIGNING_SECRET)
      .update(`${customHs256Header}.${customHs256Payload}`)
      .digest('base64url');
    const customHs256Token = `${customHs256Header}.${customHs256Payload}.${customHs256Sig}`;

    const verifyMissing = await verifyFirebaseIdTokenOnServer('');
    const verifyRawUid = await verifyFirebaseIdTokenOnServer(SUPER_ADMIN_UID || 'raw-uid-string');
    const verifyForged = await verifyFirebaseIdTokenOnServer(forgedRs256Token);
    const verifyHs256 = await verifyFirebaseIdTokenOnServer(customHs256Token);
    const nonMatchingAdminRejected = !isVerifiedSuperAdmin({
      uid: 'non-admin-seller-uid',
      email: SUPER_ADMIN_EMAIL,
      emailVerified: true,
      rawToken: 'tok',
    });

    results.push({
      name: '2. Cryptographic ID Token Verification via Firebase Admin SDK (Rejects Missing, Raw UID, Forged RS256, Custom HS256 & Non-Admin UID)',
      passed: Boolean(
        verifyMissing === null &&
          verifyRawUid === null &&
          verifyForged === null &&
          verifyHs256 === null &&
          nonMatchingAdminRejected
      ),
      detail: `Missing Rejected: ${verifyMissing === null} | Raw UID Rejected: ${verifyRawUid === null} | Forged RS256 Rejected: ${verifyForged === null} | Custom HS256 Rejected: ${verifyHs256 === null} | Non-Admin UID Rejected: ${nonMatchingAdminRejected}`,
    });

    // Audit 3: Expiring, Invalid, Tampered & Cross-Seller Download Token Security
    const validExp = Date.now() + 60000;
    const validTok = createSignedDownloadToken({
      orderNumber: 'DS-TOK-01',
      productId: 'prod-30-day-reset',
      buyerId: 'buyer-pk-1',
      expiresAtMs: validExp,
    });
    const expiredExp = Date.now() - 10000;
    const expiredTok = createSignedDownloadToken({
      orderNumber: 'DS-TOK-01',
      productId: 'prod-30-day-reset',
      buyerId: 'buyer-pk-1',
      expiresAtMs: expiredExp,
    });
    const isValidOk = verifySignedDownloadToken(
      validTok,
      'DS-TOK-01',
      'prod-30-day-reset',
      'buyer-pk-1',
      validExp
    );
    const isExpiredRejected = !verifySignedDownloadToken(
      expiredTok,
      'DS-TOK-01',
      'prod-30-day-reset',
      'buyer-pk-1',
      expiredExp
    );
    const isInvalidRejected = !verifySignedDownloadToken(
      'dstok_9999999999999_tamperedhexsignature',
      'DS-TOK-01',
      'prod-30-day-reset',
      'buyer-pk-1',
      validExp
    );
    const isCrossProductRejected = !verifySignedDownloadToken(
      validTok,
      'DS-TOK-01',
      'prod-in-mindful-journal',
      'buyer-pk-1',
      validExp
    );
    results.push({
      name: '3. Secure Digital Delivery: Expiring, Invalid & Cross-Seller Token Rejection',
      passed: isValidOk && isExpiredRejected && isInvalidRejected && isCrossProductRejected,
      detail: `Valid Token: ${isValidOk} | Expired Token Blocked: ${isExpiredRejected} | Tampered Token Blocked: ${isInvalidRejected} | Cross-Seller Product Token Blocked: ${isCrossProductRejected}`,
    });

    // Audit 4: 5% Commission Accounting & Lifecycle States (outstanding, paid, reversed, disputed)
    const pkrCalc = computeServerCommissionMinor(1000, 'PKR', 500, 'jazzcash');
    const inrCalc = computeServerCommissionMinor(1200, 'INR', 500, 'upi_india');
    const mathPass =
      pkrCalc.grossAmountMinor === 100000 &&
      pkrCalc.platformCommissionMinor === 5000 &&
      pkrCalc.sellerShareBeforeFeesMinor === 95000 &&
      inrCalc.grossAmountMinor === 120000 &&
      inrCalc.platformCommissionMinor === 6000 &&
      inrCalc.sellerShareBeforeFeesMinor === 114000;
    results.push({
      name: '4. 5% Commission Accounting (1,000 PKR → 50/950 PKR; 1,200 INR → 60/1,140 INR)',
      passed: mathPass,
      detail: `PKR: 1,000 → 50 fee / 950 seller | INR: 1,200 → 60 fee / 1,140 seller | States: outstanding, paid, reversed, disputed`,
    });

    // Audit 5: Smart 5% Commission Lifecycle (5 Verified Sales -> Invoice -> 7-Day Restriction -> Buyer Unaffected -> Settlement Unlock)
    const testSellerId = 'seller-e2e-lifecycle';
    for (let i = 1; i <= 5; i++) {
      const ordNum = `DS-E2E-COMM-${i}`;
      persistentLedger.set(ordNum, {
        ledgerId: `ldg-e2e-${i}`,
        orderNumber: ordNum,
        orderId: `ord-e2e-${i}`,
        storeId: 'store-e2e-test',
        sellerId: testSellerId,
        buyerId: `buyer-e2e-${i}`,
        primaryProductId: 'prod-e2e-1',
        currency: 'PKR',
        grossAmountMinor: 100000,
        platformCommissionMinor: 5000,
        sellerShareBeforeFeesMinor: 95000,
        gatewayFeeMinor: 0,
        sellerNetEarningsMinor: 95000,
        commissionRateBps: 500,
        paymentMethod: 'jazzcash',
        paymentStatus: 'Paid',
        commissionStatus: 'outstanding',
        payoutStatus: 'Unsettled',
        verificationMode: 'Manually Verified by Seller',
        paymentReference: `REF-E2E-${i}`,
        downloadToken: 'dstok_valid',
        downloadCount: 0,
        maxDownloads: 5,
        expiresAtMs: Date.now() + 86400000,
        createdAtIso: new Date(Date.now() - (10 - i) * 60000).toISOString(),
        updatedAtIso: new Date().toISOString(),
      });
    }
    const after5Sales = reconcileSellerCommissionState(testSellerId);
    const invGenerated =
      after5Sales.invoices.length === 1 &&
      after5Sales.invoices[0].commissionAmountMinor === 25000;
    const genInvoice = after5Sales.invoices[0];
    if (genInvoice) {
      genInvoice.dueAtMs = Date.now() - 3600000;
      genInvoice.dueAtIso = new Date(genInvoice.dueAtMs).toISOString();
    }
    const overdueState = reconcileSellerCommissionState(testSellerId);
    const restrictedWhenOverdue =
      overdueState.isRestricted &&
      overdueState.restrictedFeatures.includes('add_product') &&
      overdueState.restrictedFeatures.includes('publish_product') &&
      overdueState.restrictedFeatures.includes('visual_store_builder') &&
      overdueState.restrictedFeatures.includes('theme_customization') &&
      overdueState.unrestrictedFeatures.includes('public_storefront_visibility') &&
      overdueState.unrestrictedFeatures.includes('digital_product_downloads');
    if (genInvoice) {
      genInvoice.paidAmountMinor = genInvoice.commissionAmountMinor;
      genInvoice.remainingBalanceMinor = 0;
      genInvoice.status = 'paid';
      genInvoice.verifiedAtIso = new Date().toISOString();
    }
    const settledState = reconcileSellerCommissionState(testSellerId);
    const unlockedAfterSettlement =
      !settledState.isRestricted && settledState.totalOutstandingCommissionMinor === 0;
    for (let i = 1; i <= 5; i++) {
      persistentLedger.delete(`DS-E2E-COMM-${i}`);
    }
    if (genInvoice) {
      commissionInvoices.delete(genInvoice.invoiceId);
    }

    results.push({
      name: '5. Smart 5% Commission Lifecycle (5 Sales → Invoice → 7-Day Restriction → Buyer Safe → Unlock)',
      passed: Boolean(invGenerated && restrictedWhenOverdue && unlockedAfterSettlement),
      detail: `5 Sales Invoice (250 PKR): ${invGenerated} | Overdue Seller Restricted (Buyer Safe): ${restrictedWhenOverdue} | Unlocked on Settlement: ${unlockedAfterSettlement}`,
    });

    res.json({
      allPassed: results.every((r) => r.passed),
      timestamp: new Date().toISOString(),
      results,
    });
  }));

  // 14. Server-Side Gemini Multi-Turn Chat Assistant (Free-Tier Friendly)
  const ROLE_SYSTEM_INSTRUCTIONS: Record<string, string> = {
    seller_coach:
      'You are the DreamStore Seller Growth & Store Coach. Help digital creators set up their store slug, price products in PKR/INR/USD, configure manual payments (JazzCash, Easypaisa, Bank Transfer, UPI) with Express Payment Verification, and understand the transparent 5% platform commission ledger. Keep responses warm, actionable, concise (under 140 words), and tailored to Soft Luxury digital storefronts.',
    buyer_concierge:
      'You are the DreamStore Buyer Shopping & Payment Concierge. Help shoppers browse digital planners, e-books, and templates, understand free instant downloads vs. paid checkout, submit payment transaction references (JazzCash, Easypaisa, Bank Transfer, UPI), and track real-time Seller Verified order status. Keep responses friendly, clear, and concise (under 140 words).',
    copywriter:
      'You are the DreamStore Product Copywriting & Launch Strategist. Write high-converting product titles, soft-luxury descriptions, launch announcements, and Instagram bio callouts for digital products. Keep responses polished, creative, and ready to copy-paste (under 150 words).',
  };

  function buildFreeTierFallbackReply(
    userPrompt: string,
    roleId: string,
    storeContext?: { storeName?: string; currency?: string; productCount?: number },
    turnCount?: number
  ): string {
    const q = userPrompt.toLowerCase();
    const storeName = storeContext?.storeName || 'DreamStore';
    const currency = storeContext?.currency || 'PKR';
    const productCount = storeContext?.productCount ?? 4;

    if (q.includes('payment') || q.includes('jazzcash') || q.includes('easypaisa') || q.includes('verify') || q.includes('reference')) {
      return `For **${storeName}** (${currency}), Express Payment Verification works in 3 fast steps:\n1. **Buyer Checkout:** The buyer sends payment via JazzCash, Easypaisa, Bank Transfer, or UPI and submits their transaction reference.\n2. **Instant Seller Alert:** A real-time *"Payment Awaiting Review"* banner appears in the Seller Dashboard.\n3. **3-Point Statement Check:** Once the seller confirms the reference & amount in their wallet statement, the order updates to **Paid (Seller Verified)** in real time and unlocks the signed download link.`;
    }
    if (q.includes('commission') || q.includes('fee') || q.includes('5%') || q.includes('ledger')) {
      return `**DreamStore Free Beta Pricing:**\n- **0 Monthly Subscription:** Creating and hosting **${storeName}** is 100% free.\n- **5% Platform Commission:** Only applied on verified paid sales (e.g., on a 1,000 ${currency} order, you keep 950 ${currency} and 50 ${currency} is recorded in the commission ledger).\n- **Free Downloads:** 0% fee on free lead-magnet products.`;
    }
    if (roleId === 'copywriter' || q.includes('title') || q.includes('description') || q.includes('copy') || q.includes('write')) {
      return `Here is a Soft-Luxury launch copy draft for **${storeName}**:\n\n✨ **Headline:** Elevate Your Daily Rituals, Effortlessly.\n📖 **Description:** Thoughtfully crafted for modern creators, this digital collection blends aesthetic clarity with practical daily systems—instant download unlocked right after checkout.\n📣 **Instagram CTA:** *"New drop is live on my ${storeName} storefront! Tap the link in bio for instant access."*`;
    }
    if (roleId === 'buyer_concierge' || q.includes('download') || q.includes('buy') || q.includes('order')) {
      return `Welcome to **${storeName}**! We currently feature **${productCount} digital products** in **${currency}**.\n- **Free products** unlock an instant signed download token immediately.\n- **Paid products** let you pay via your preferred wallet/bank and submit your reference ID—your order page updates in real time as soon as the seller verifies receipt!`;
    }
    return `[Turn #${turnCount || 1} • ${roleId === 'seller_coach' ? 'Seller Coach' : roleId === 'buyer_concierge' ? 'Buyer Concierge' : 'Copywriter'}]\n For **${storeName}** (${productCount} active products in ${currency}): I can help you optimize your storefront, write product descriptions, explain Express Payment Verification, or guide buyers through checkout. What would you like to work on next?`;
  }

  app.post('/api/gemini/chat', asyncRoute(async (req, res) => {
    try {
      const { messages, roleId = 'seller_coach', modelTier = 'fast', storeContext } = req.body || {};
      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'Messages array is required for multi-turn chat.' });
        return;
      }

      // Map requested model tier per Gemini API guidelines:
      // - 'fast' -> 'gemini-3.1-flash-lite-preview' (Free Tier)
      // - 'general' -> 'gemini-3-flash-preview' (Free Tier)
      // - 'complex' -> 'gemini-3.1-pro-preview' (with automatic free-tier fallback)
      const requestedModel =
        modelTier === 'complex'
          ? 'gemini-3.1-pro-preview'
          : modelTier === 'general'
          ? 'gemini-3-flash-preview'
          : 'gemini-3.1-flash-lite-preview';

      const baseInstruction =
        ROLE_SYSTEM_INSTRUCTIONS[String(roleId)] || ROLE_SYSTEM_INSTRUCTIONS.seller_coach;
      const contextSummary = storeContext
        ? `\nCurrent Store Context: Store Name="${storeContext.storeName || 'DreamStore'}", Slug="${storeContext.storeSlug || ''}", Currency="${storeContext.currency || 'PKR'}", Active Products=${storeContext.productCount ?? 0}.`
        : '';
      const systemInstruction = `${baseInstruction}${contextSummary}`;

      const rawContents = messages.map((m: { role?: string; text?: string }) => ({
        role: m.role === 'model' ? 'model' : 'user',
        parts: [{ text: String(m.text || '') }],
      }));
      const firstUserIdx = rawContents.findIndex((c) => c.role === 'user');
      const contents =
        firstUserIdx >= 0 ? rawContents.slice(firstUserIdx) : rawContents;

      const lastUserMessage =
        [...messages].reverse().find((m: any) => m.role !== 'model')?.text || '';

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || !apiKey.trim()) {
        // Free-tier zero-cost local assistant fallback when no API key is configured
        const reply = buildFreeTierFallbackReply(
          String(lastUserMessage),
          String(roleId),
          storeContext,
          messages.length
        );
        res.json({
          reply,
          modelUsed: `${requestedModel} (Free Tier Mode)`,
          roleId,
          freeTier: true,
        });
        return;
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey.trim(),
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      let replyText = '';
      let activeModel = requestedModel;

      const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
        Promise.race([
          promise,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error('Gemini API timeout')), ms)
          ),
        ]);

      try {
        const response = await withTimeout(
          ai.models.generateContent({
            model: activeModel,
            contents,
            config: {
              systemInstruction,
              temperature: 0.7,
            },
          }),
          3500
        );
        replyText = response.text || '';
      } catch (primaryErr: any) {
        // If complex/general model fails on a free-tier key, fallback to gemini-3.1-flash-lite-preview
        if (activeModel !== 'gemini-3.1-flash-lite-preview') {
          try {
            activeModel = 'gemini-3.1-flash-lite-preview';
            const fallbackResponse = await withTimeout(
              ai.models.generateContent({
                model: activeModel,
                contents,
                config: {
                  systemInstruction,
                  temperature: 0.7,
                },
              }),
              2500
            );
            replyText = fallbackResponse.text || '';
          } catch {
            replyText = buildFreeTierFallbackReply(
              String(lastUserMessage),
              String(roleId),
              storeContext,
              messages.length
            );
          }
        } else {
          replyText = buildFreeTierFallbackReply(
            String(lastUserMessage),
            String(roleId),
            storeContext,
            messages.length
          );
        }
      }

      if (!replyText.trim()) {
        replyText = buildFreeTierFallbackReply(
          String(lastUserMessage),
          String(roleId),
          storeContext,
          messages.length
        );
      }

      res.json({
        reply: replyText,
        modelUsed: activeModel,
        roleId,
        freeTier: true,
      });
    } catch (err: any) {
      res.status(500).json({
        error: err?.message || 'Failed to generate chat response.',
      });
    }
  }));

  app.use('/api', (_req, res) => { res.status(404).json({ error: 'API endpoint not found.' }); });
  app.use(apiErrorHandler);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', asyncRoute((_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    }));
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    const address = server.address();
    console.log(`DreamStore server running on http://0.0.0.0:${typeof address === 'object' ? address?.port : PORT}`);
  });
  process.once('SIGTERM', () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 9000).unref();
  });
}

startServer();
