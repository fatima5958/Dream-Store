import express, { type Request, type Response } from 'express';
import { ApiError, handleApiError } from './errors.ts';
import type { Principal, Role, UserProfile, V2Dependencies } from './contracts.ts';
import { authenticatedPrincipal, isVerifiedSuperAdmin } from './modules/auth.ts';
import { canonicalStoreId, rolePermissions } from './modules/users.ts';
import { publicStoreProjection, isValidStoreSlug } from './modules/stores.ts';

import { requireSeller, requireId } from './modules/policy.ts';
import { registerPaymentSettingsRoutes } from './modules/payment-settings.ts';
import { registerCheckoutRoutes } from './modules/checkout.ts';
import { registerOrderRoutes } from './modules/orders.ts';
import { registerDownloadRoutes } from './modules/downloads.ts';
import { registerPaymentVerificationRoutes } from './modules/payment-verification.ts';
import { registerCommissionRoutes } from './modules/commissions.ts';

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
  app.use(express.json({ limit: '1mb' }));
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

  const updateStore = jsonRoute(async (req, res) => {
    const principal = await authenticatedPrincipal(req, deps);
    await requireSeller(principal, deps);
    if (!deps.stores) throw new ApiError(501, 'backend/v2-not-implemented', 'Store operations unavailable.');
    const store = await deps.stores.update(principal, requireId(req.body?.storeId, 'store ID'), req.body?.updates);
    res.json({ ok: true, store });
  });
  app.post('/api/stores/update', updateStore);
  app.post('/api/stores/visit', jsonRoute(async (req, res) => {
    if (!deps.allowWrites) throw new ApiError(503, 'backend/staging-readonly', 'Visits require isolated staging writes.');
    if (!deps.stores) throw new ApiError(501, 'backend/v2-not-implemented', 'Store operations unavailable.');
    const target = req.body?.storeId || req.body?.storeSlug;
    if (typeof target !== 'string' || !target || target.length > 128) throw new ApiError(422, 'store/invalid-target', 'A store ID or slug is required.');
    await deps.stores.visit(target, req.body?.isCheckoutView === true, req.ip || 'unknown');
    // Public visits never expose a seller's conversion metrics.
    res.json({ ok: true });
  }));
  const storefront = jsonRoute(async (req, res) => {
    if (!deps.stores || !deps.products) throw new ApiError(501, 'backend/v2-not-implemented', 'Storefront unavailable.');
    const viewer = req.headers.authorization ? await authenticatedPrincipal(req, deps) : null;
    const store = await deps.stores.find(String(req.params.slug));
    if (!store || store.status !== 'Active' && !(viewer?.emailVerified && store.ownerId === viewer.uid)) throw new ApiError(404, 'store/not-found', 'Public store not found.');
    res.json({ store: publicStoreProjection(store.storeId, store), products: await deps.products.list(store.storeId, viewer) });
  });
  // Static routes precede this single-segment slug route.
  app.get('/api/stores/by-slug/:slug', storefront);
  app.get('/api/stores/:slug', storefront);

  app.get('/api/products', jsonRoute(async (req, res) => {
    if (!deps.products) throw new ApiError(501, 'backend/v2-not-implemented', 'Catalog unavailable.');
    const viewer = req.headers.authorization ? await authenticatedPrincipal(req, deps) : null;
    res.json({ products: await deps.products.list(requireId(req.query.storeId, 'store ID'), viewer) });
  }));
  const saveProduct = jsonRoute(async (req, res) => {
    const principal = await authenticatedPrincipal(req, deps);
    await requireSeller(principal, deps);
    if (!deps.products) throw new ApiError(501, 'backend/v2-not-implemented', 'Catalog unavailable.');
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new ApiError(422, 'request/invalid-body', 'A product object is required.');
    res.json({ ok: true, product: await deps.products.save(principal, req.body) });
  });
  for (const path of ['/api/products', '/api/products/upsert', '/api/products/save']) app.post(path, saveProduct);
  app.post('/api/products/delete', jsonRoute(async (req, res) => {
    const principal = await authenticatedPrincipal(req, deps);
    await requireSeller(principal, deps);
    if (!deps.products) throw new ApiError(501, 'backend/v2-not-implemented', 'Catalog unavailable.');
    const id = requireId(req.body?.productId, 'product ID');
    await deps.products.remove(principal, id);
    res.json({ ok: true, deletedId: id, archived: true });
  }));
  // Authenticate before parsing up to 5 MiB of binary data.
  const authorizeUpload: express.RequestHandler = (req, res, next) => {
    Promise.resolve((async () => {
      const principal = await authenticatedPrincipal(req, deps);
      await requireSeller(principal, deps);
      res.locals.principal = principal;
      next();
    })()).catch(next);
  };
  for (const kind of ['product', 'cover'] as const) {
    app.post('/api/uploads/' + kind, authorizeUpload,
      express.raw({ type: 'application/octet-stream', limit: 5 * 1024 * 1024 }), jsonRoute(async (req, res) => {
        if (!deps.uploads) throw new ApiError(501, 'backend/v2-not-implemented', 'Uploads unavailable.');
        let fileName = '';
        try { fileName = decodeURIComponent(String(req.headers['x-file-name'] || '')); }
        catch { throw new ApiError(422, 'upload/invalid-name', 'Filename is invalid.'); }
        res.json(await deps.uploads.save(res.locals.principal, {
          productId: requireId(req.headers['x-product-id'], 'product ID'),
          storeId: requireId(req.headers['x-store-id'], 'store ID'), fileName,
          contentType: String(req.headers['x-file-type'] || '').toLowerCase(), data: req.body, kind,
        }));
      }));
  }
  app.get('/api/assets/covers/:ownerId/:fileName', jsonRoute(async (req, res) => {
    if (!deps.covers) throw new ApiError(501, 'backend/v2-not-implemented', 'Covers unavailable.');
    const ownerId = requireId(req.params.ownerId, 'owner ID');
    const name = String(req.params.fileName);
    if (!/^[A-Za-z0-9._-]{1,180}$/.test(name)) throw new ApiError(422, 'upload/invalid-name', 'Invalid cover name.');
    const cover = await deps.covers.read(ownerId, name);
    res.set('Content-Type', cover.contentType);
    res.set('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(cover.data);
  }));

  if (deps.finance) {
    registerPaymentSettingsRoutes(app, deps);
    registerCheckoutRoutes(app, deps);
    registerOrderRoutes(app, deps);
    registerPaymentVerificationRoutes(app, deps);
    registerDownloadRoutes(app, deps);
    registerCommissionRoutes(app, deps);
  }

  // Financial, download and administrative modules remain deliberately unavailable.
  app.use('/api', (_req, res) => {
    res.status(501).json({
      code: 'backend/v2-not-implemented',
      error: 'This endpoint has not yet been migrated to Backend V2.',
    });
  });
  app.use(handleApiError);
  return app;
}
