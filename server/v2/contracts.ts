import type { Request } from 'express';

export type AccountRole = 'buyer' | 'seller';
export type Role = AccountRole | 'super_admin';

export interface Principal {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  roleClaim?: string;
  superAdminClaim?: boolean;
}

export interface UserProfile {
  uid: string;
  role: Role;
  displayName: string;
  email: string;
  onboardingCompleted: boolean;
  storeId?: string;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface AuthVerifier {
  verifyBearer(token: string): Promise<Principal>;
}

export interface ProfileRepository {
  find(principal: Principal): Promise<UserProfile | null>;
  save(principal: Principal, role: AccountRole, displayName: string): Promise<UserProfile>;
}

export interface CreatorCampaignRepository {
  read(): Promise<{ limit: 100; claimed: number; remaining: number; soldOut: boolean; offer: 'free_storefront_setup' }>;
}

export interface StoreCreateResult {
  store: Record<string, unknown>;
  existed: boolean;
  creatorClaimNumber: number | null;
}

export interface StoreRepository {
  listPublic(): Promise<Array<Record<string, unknown>>>;
  checkSlug(slug: string, viewer?: Principal | null, excludeStoreId?: string): Promise<boolean>;
  create(principal: Principal, body: Record<string, unknown>): Promise<StoreCreateResult>;
  find(target: string): Promise<Record<string, any> | null>;
  update(principal: Principal, storeId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>>;
  visit(target: string, checkout: boolean, visitorKey: string): Promise<void>;
}

export interface ReadinessService {
  check(): Promise<boolean>;
}

export interface AdminManagementRepository {
  updateStore(storeId: string, patch: Record<string, unknown>, actorUid: string, action: string): Promise<Record<string, any> | null>;
  grantPro(input: { sellerId?: string; storeId?: string; grantPro: boolean; actorUid: string }): Promise<{ sellerId: string; storeIds: string[]; plan: 'Pro' | 'Free' }>;
}
export interface SubscriptionRepository {
  entitlement(sellerId: string): Promise<Record<string, any> | null>;
  list(sellerId?: string, storeId?: string): Promise<Array<Record<string, any>>>;
  requestWaitlist(sellerId: string): Promise<Record<string, any>>;
}

export interface V2Dependencies {
  auth: AuthVerifier;
  profiles: ProfileRepository;
  creators: CreatorCampaignRepository;
  stores?: StoreRepository;
  products?: ProductRepository;
  finance?: FinancialRepository;
  management?: AdminManagementRepository;
  subscriptions?: SubscriptionRepository;
  uploads?: UploadRepository;
  covers?: { read(ownerId: string, fileName: string): Promise<{ data: Buffer; contentType: string }> };
  readiness: ReadinessService;
  adminUid: string;
  // Staging writes are disabled by default. Real production cutover is separate.
  allowWrites: boolean;
  allowUnsignedEmulatorTokens?: boolean;
  paidCheckoutEnabled?: boolean;
  downloadTokenSecret?: string;
}

export type AuthenticatedRequest = Request & { principal?: Principal };

export interface ProductRepository {
  list(storeId: string, viewer?: Principal | null): Promise<Array<Record<string, unknown>>>;
  save(principal: Principal, input: Record<string, any>): Promise<Record<string, unknown>>;
  remove(principal: Principal, id: string): Promise<void>;
}
export interface UploadRepository {
  save(principal: Principal, input: { productId: string; storeId: string; fileName: string; contentType: string; data: Buffer; kind: 'product' | 'cover' }): Promise<Record<string, unknown>>;
}

export interface FinancialRepository {
  store(target: string): Promise<Record<string, any> | null>;
  paymentSettings(ownerId: string): Promise<Record<string, any> | null>;
  savePaymentSettings(ownerId: string, storeId: string, settings: Record<string, unknown>): Promise<Record<string, unknown>>;
  createOrder(input: Record<string, any>): Promise<{ duplicate: boolean; order: Record<string, any> }>;
  order(orderNumber: string): Promise<Record<string, any> | null>;
  listOrders(uid: string, admin: boolean): Promise<Array<Record<string, any>>>;
  ledgerEntries?(sellerId: string | undefined, admin: boolean, storeId: string | undefined, cursor: string | undefined, limit: number): Promise<{ entries: Array<Record<string, any>>; auditTrail: Array<Record<string, any>>; nextCursor: string | null; hasMore: boolean }>;
  emailNotification?(orderNumber: string): Promise<Record<string, any> | null>;
  issueCommissionInvoices?(sellerId: string): Promise<Array<Record<string, any>>>;
  commissionRecords?(sellerId?: string): Promise<{ invoices: Array<Record<string, any>>; payments: Array<Record<string, any>>; adjustments: Array<Record<string, any>> }>;
  submitCommissionPayment?(input: Record<string, any>): Promise<{ payment: Record<string, any>; invoice: Record<string, any> }>;
  reviewCommissionPayment?(input: Record<string, any>): Promise<{ payment: Record<string, any>; invoice: Record<string, any> }>;
  disputeCommission?(orderNumber: string, sellerId: string, note: string): Promise<Record<string, any>>;
  listCommissionDisputes?(limit: number): Promise<Array<Record<string, any>>>;
  resolveCommissionDispute?(input: { disputeId: string; decision: 'approve' | 'reject'; actorUid: string; explanation: string }): Promise<Record<string, any>>;
  transitionOrder(orderNumber: string, expectedStatus: string, patch: Record<string, unknown>, actorUid: string): Promise<Record<string, any>>;
  consumeDownload(orderNumber: string, buyerUid: string, productId: string, tokenId: string): Promise<{ order: Record<string, any>; deliverable: Record<string, any>; fileDataUrl: string }>;
}
