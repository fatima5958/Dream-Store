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
}

export interface ReadinessService {
  check(): Promise<boolean>;
}

export interface V2Dependencies {
  auth: AuthVerifier;
  profiles: ProfileRepository;
  creators: CreatorCampaignRepository;
  stores?: StoreRepository;
  readiness: ReadinessService;
  adminUid: string;
  // Staging writes are disabled by default. Real production cutover is separate.
  allowWrites: boolean;
}

export type AuthenticatedRequest = Request & { principal?: Principal };
