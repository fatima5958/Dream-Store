import express, { type Request, type Response } from 'express';
import { ApiError, handleApiError } from './errors';
import type { Principal, Role, UserProfile, V2Dependencies } from './contracts';
import { authenticatedPrincipal, isVerifiedSuperAdmin } from './modules/auth';
import { canonicalStoreId, rolePermissions } from './modules/users';
import { isValidStoreSlug } from './modules/stores';

const jsonRoute = (callback: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: (error?: unknown) => void) => {
    Promise.resolve(callback(req, res)).catch(next);
  };

function privilegedProfile(principal: Principal): UserProfile {
  const now = new Date().toISOString();
  return {
    uid: principal.uid,
    role: 'super_admin',
    displayName: (principal.displayName || 'Administrator').slice(0, 120),
    email: principal.email,
    onboardingCompleted: true,
    storeId: canonicalStoreId(principal.uid),
    createdAtIso: now,
    updatedAtIso: now,
  };
}

async function resolveProfile(principal: Principal, deps: V2Dependencies): Promise<UserProfile | null> {
  if (isVerifiedSuperAdmin(principal, deps.adminUid)) return privilegedProfile(principal);
  return deps.profiles.find(principal);
}

function validateRole(raw: unknown): 'buyer' | 'seller' {
  if (raw !== 'buyer' && raw !== 'seller') {
    throw new ApiError(400, 'profile/invalid-role', 'Choose Buyer or Seller to continue.');
  }
  return raw;
}

export function createV2App(deps: V2Dependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.get('/api/health', (_req, res) => res.json({
    status: 'ok',
    service: 'DreamStore Multi-Vendor API',
    timestamp: new Date().toISOString(),
  }));
  app.get('/api/ready', jsonRoute(async (_req, res) => {
    const ready = await deps.readiness.check();
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready' });
  }));

  const readProfile = jsonRoute(async (req, res) => {
    const principal = await authenticatedPrincipal(req, deps);
    const profile = await resolveProfile(principal, deps);
    res.json({
      ok: true,
      exists: profile !== null,
      needsOnboarding: profile === null || !profile.onboardingCompleted,
      profile,
      permissions: profile ? rolePermissions(profile.role) : null,
    });
  });

  const saveProfile = jsonRoute(async (req, res) => {
    const principal = await authenticatedPrincipal(req, deps);
    if (isVerifiedSuperAdmin(principal, deps.adminUid)) {
      throw new ApiError(403, 'auth/role-forbidden', 'Administrator roles cannot be changed by onboarding.');
    }
    if (!deps.allowWrites) {
      throw new ApiError(503, 'backend/staging-readonly', 'Backend V2 writes are disabled outside its isolated emulator.');
    }
    const role = validateRole(req.body?.role);
    const cleanName = String(req.body?.displayName || req.body?.name || '').trim();
    const profile = await deps.profiles.save(principal, role, cleanName);
    res.json({ ok: true, profile, permissions: rolePermissions(role) });
  });

  app.get('/api/users/profile', readProfile);
  app.post('/api/users/profile', saveProfile);
  app.post('/api/users/role', saveProfile);
  app.get('/api/auth/onboarding', readProfile);
  app.post('/api/auth/onboarding', saveProfile);

  const access = jsonRoute(async (req, res) => {
    const principal = await authenticatedPrincipal(req, deps);
    const profile = await resolveProfile(principal, deps);
    if (!profile || !profile.onboardingCompleted) {
      throw new ApiError(403, 'auth/onboarding-required', 'Complete account onboarding first.');
    }
    const requestedScreen = String(req.query.screen || req.body?.screen || '').trim().toLowerCase();
    const role: Role = profile.role;
    const permissions = rolePermissions(role);
    if (requestedScreen && !permissions.allowedScreens.includes(requestedScreen)) {
      res.status(403).json({
        ok: false, allowed: false, role,
        redirectScreen: role === 'buyer' ? 'storefront' : 'owner-dashboard',
        permissions,
        error: 'This screen is not available to your account role.',
      });
      return;
    }
    res.json({ ok: true, allowed: true, role, permissions });
  });
  app.get('/api/navigation/access', access);
  app.post('/api/navigation/access', access);
  app.get('/api/auth/verify-screen-access', access);

  const verifyAdmin = jsonRoute(async (req, res) => {
    const principal = await authenticatedPrincipal(req, deps);
    if (!isVerifiedSuperAdmin(principal, deps.adminUid)) {
      throw new ApiError(403, 'auth/admin-forbidden', 'This account is not an administrator.');
    }
    res.json({ ok: true, isSuperAdmin: true, uid: principal.uid, email: principal.email });
  });
  app.get('/api/admin/verify-session', verifyAdmin);
  app.post('/api/admin/verify-session', verifyAdmin);

  app.get('/api/launch/creator-spots', jsonRoute(async (_req, res) => {
    res.json(await deps.creators.read());
  }));

  // Guest discovery is read-only, backed by the same named Firestore database
  // as Seller creation. Never reveal private payment or seller settings.
  app.get('/api/stores', jsonRoute(async (_req, res) => {
    if (!deps.stores) throw new ApiError(501, 'backend/v2-not-implemented', 'Store directory is unavailable.');
    res.json({ stores: await deps.stores.listPublic() });
  }));

  // Public slug checks do not authorize mutation. A token, when supplied, is
  // verified before an "excludeStoreId" may refer to an owned store.
  app.get('/api/stores/check-slug', jsonRoute(async (req, res) => {
    const slug = String(req.query.slug || '').trim().toLowerCase();
    if (!isValidStoreSlug(slug)) {
      res.json({ available: false, slug, reason: 'Choose a valid, non-reserved store URL.' });
      return;
    }
    if (!deps.stores) throw new ApiError(501, 'backend/v2-not-implemented', 'Store operations are not available.');
    const viewer = req.headers.authorization
      ? await authenticatedPrincipal(req, deps)
      : null;
    const excludeStoreId = String(req.query.excludeStoreId || '').trim();
    const available = await deps.stores.checkSlug(slug, viewer, excludeStoreId);
    res.json({ available, slug, reason: available ? null : 'This store URL is already taken by another creator.' });
  }));

  const createStore = jsonRoute(async (req, res) => {
    const principal = await authenticatedPrincipal(req, deps);
    if (!principal.emailVerified) {
      throw new ApiError(403, 'auth/email-not-verified', 'Verify your email before creating a store.');
    }
    // Admin store creation for third parties is not migrated in this slice.
    // Do not grant privileged write behavior from an unchecked request body.
    if (isVerifiedSuperAdmin(principal, deps.adminUid)) {
      throw new ApiError(501, 'backend/v2-admin-store-pending', 'Administrator store creation is not migrated yet.');
    }
    if (!deps.allowWrites) {
      throw new ApiError(503, 'backend/staging-readonly', 'Backend V2 writes are disabled outside its isolated emulator.');
    }
    if (!deps.stores) throw new ApiError(501, 'backend/v2-not-implemented', 'Store operations are not available.');
    const profile = await deps.profiles.find(principal);
    if (!profile || profile.role !== 'seller' || !profile.onboardingCompleted) {
      throw new ApiError(403, 'store/seller-required', 'Complete verified Seller onboarding before creating a store.');
    }
    const result = await deps.stores.create(principal, req.body || {});
    res.status(result.existed ? 200 : 201).json({
      ok: true, store: result.store, creatorClaimNumber: result.creatorClaimNumber,
    });
  });
  app.post('/api/stores/create', createStore);
  app.post('/api/stores/upsert', createStore);

  // No shadow writes, payments or public file access. These endpoints stay on
  // V1 until ported and individually tested. A V2-only process must never
  // silently pretend an unimplemented operation succeeded.
  app.use('/api', (_req, res) => {
    res.status(501).json({
      code: 'backend/v2-not-implemented',
      error: 'This endpoint has not yet been migrated to Backend V2.',
    });
  });
  app.use(handleApiError);
  return app;
}
