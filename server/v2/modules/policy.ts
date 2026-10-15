import { ApiError } from '../errors.ts';
import type { Principal, V2Dependencies } from '../contracts.ts';

export const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function requireId(value: unknown, label: string): string {
  if (!validId(value)) throw new ApiError(422, 'request/invalid-id', `Invalid ${label}.`);
  return value;
}
export function assertOwnedActive(store: Record<string, any> | undefined, p: Principal) {
  if (!p.emailVerified) throw new ApiError(403, 'auth/email-not-verified', 'Verify your email first.');
  if (!store) throw new ApiError(404, 'store/not-found', 'Store not found.');
  if (store.ownerId !== p.uid) throw new ApiError(403, 'store/owner-forbidden', 'This store belongs to another seller.');
  if (store.status !== 'Active') throw new ApiError(403, 'store/suspended', 'This store is not active and cannot be changed.');
}
export async function requireSeller(p: Principal, deps: V2Dependencies) {
  if (!p.emailVerified) throw new ApiError(403, 'auth/email-not-verified', 'Verify your email first.');
  const profile = await deps.profiles.find(p);
  if (!profile || profile.role !== 'seller' || !profile.onboardingCompleted) {
    throw new ApiError(403, 'store/seller-required', 'Complete Seller onboarding first.');
  }
  if (!deps.allowWrites) throw new ApiError(503, 'backend/staging-readonly', 'Backend V2 writes require isolated staging.');
}

// URLs embedded in public storefronts must not execute scripts or expose storage references.
export function safeImage(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  if (value.length <= 800000 && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)) return value;
  if (value.length <= 8192 && (/^https:\/\//i.test(value) || /^\/(assets\/|api\/assets\/covers\/)[A-Za-z0-9._/-]+$/.test(value))) return value;
  throw new ApiError(422, 'request/invalid-image', 'Use a supported image cover or HTTPS image URL.');
}
