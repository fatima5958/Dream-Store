import type { Express } from 'express';
import type { V2Dependencies } from '../contracts.ts';
import { ApiError } from '../errors.ts';
import { authenticatedPrincipal, isVerifiedSuperAdmin } from './auth.ts';
import { requireSeller } from './policy.ts';

export function registerSubscriptionRoutes(app: Express, deps: V2Dependencies) {
  const repository = () => {
    if (!deps.subscriptions || !deps.management) throw new ApiError(501, 'subscription/not-migrated', 'Subscription records are unavailable in this V2 environment.');
    return deps.subscriptions;
  };
  const admin = (principal: any) => isVerifiedSuperAdmin(principal, deps.adminUid);

  app.get('/api/entitlements/:sellerId', (req: any, res: any, next: any) => (async () => {
    const principal = await authenticatedPrincipal(req, deps);
    const isAdmin = admin(principal);
    const sellerId = String(req.params.sellerId || '').trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(sellerId)) throw new ApiError(400, 'subscription/invalid-seller', 'Seller identity is invalid.');
    if (!isAdmin) {
      if (sellerId !== principal.uid) throw new ApiError(403, 'subscription/owner-forbidden', 'You cannot view another Seller entitlements.');
      await requireSeller(principal, deps);
    }
    const entitlement = await repository().entitlement(sellerId);
    if (!entitlement) throw new ApiError(isAdmin ? 404 : 403, 'subscription/store-not-found', 'An owned store is required to read entitlements.');
    res.json(entitlement);
  })().catch(next));

  const getSubscriptions = async (req: any, res: any) => {
    const principal = await authenticatedPrincipal(req, deps);
    const isAdmin = admin(principal);
    const requestedSellerId = String(req.query.sellerId || req.query.ownerId || '').trim();
    const requestedStoreId = String(req.query.storeId || '').trim();
    if (!isAdmin) {
      await requireSeller(principal, deps);
      if (requestedSellerId && requestedSellerId !== principal.uid) throw new ApiError(403, 'subscription/owner-forbidden', 'You cannot view another Seller subscriptions.');
      if (!requestedSellerId && !requestedStoreId) {
        // No optional identity is required; the signed-in Seller is the scope.
      }
    }
    const sellerId = isAdmin ? requestedSellerId || undefined : principal.uid;
    if (requestedStoreId) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestedStoreId)) throw new ApiError(400, 'subscription/invalid-store', 'Store identity is invalid.');
      if (!deps.stores) throw new ApiError(503, 'subscription/store-unavailable', 'Store ownership cannot be verified.');
      const store = await deps.stores.find(requestedStoreId);
      if (!store) throw new ApiError(404, 'subscription/store-not-found', 'Store not found.');
      if (!isAdmin && store.ownerId !== principal.uid) throw new ApiError(403, 'subscription/store-forbidden', 'You cannot view another Seller subscription.');
      if (isAdmin && requestedSellerId && store.ownerId !== requestedSellerId) throw new ApiError(403, 'subscription/store-owner-mismatch', 'Store does not belong to the requested Seller.');
    }
    const subscriptions = await repository().list(sellerId, requestedStoreId || undefined);
    const hasPro = subscriptions.some(item => item.plan === 'Pro' && item.status !== 'Revoked');
    res.json({ sellerId: sellerId || requestedSellerId || '', plan: hasPro ? 'Pro' : 'Free',
      hasProEntitlement: hasPro, subscriptions });
  };
  app.get('/api/subscriptions', (req: any, res: any, next: any) => getSubscriptions(req, res).catch(next));
  app.get('/api/subscription/status', (req: any, res: any, next: any) => getSubscriptions(req, res).catch(next));

  app.post('/api/subscriptions', (req: any, res: any, next: any) => (async () => {
    const principal = await authenticatedPrincipal(req, deps);
    await requireSeller(principal, deps);
    if (req.body?.status !== 'Waitlist') throw new ApiError(409, 'subscription/waitlist-only', 'This endpoint accepts Pro waitlist requests only; it cannot activate a paid subscription.');
    const subscription = await repository().requestWaitlist(principal.uid);
    res.json({ ok: true, subscription });
  })().catch(next));

  const grant = (req: any, res: any, next: any) => (async () => {
    const principal = await authenticatedPrincipal(req, deps);
    if (!admin(principal)) throw new ApiError(403, 'auth/admin-forbidden', 'Only the verified Super Admin can change Pro entitlements.');
    const sellerId = String(req.body?.targetSellerId || req.body?.sellerId || '').trim();
    const storeId = String(req.body?.storeId || '').trim();
    const grantPro = req.body?.grantPro === undefined ? true : req.body.grantPro;
    if ((!sellerId && !storeId) || (sellerId && !/^[A-Za-z0-9_-]{1,128}$/.test(sellerId)) ||
        (storeId && !/^[A-Za-z0-9_-]{1,128}$/.test(storeId)) || typeof grantPro !== 'boolean') {
      throw new ApiError(400, 'subscription/invalid-grant', 'Provide a valid Seller or store identity and boolean grantPro value.');
    }
    const updated = await deps.management!.grantPro({ sellerId: sellerId || undefined, storeId: storeId || undefined, grantPro, actorUid: principal.uid });
    res.json({ ok: true, targetSellerId: updated.sellerId, storeId: storeId || undefined,
      plan: updated.plan, hasProEntitlement: updated.plan === 'Pro', updatedByUid: principal.uid,
      updatedStoreCount: updated.storeIds.length });
  })().catch(next);
  app.post('/api/commission/admin/grant-pro', grant);
  app.post('/api/admin/subscriptions/grant-pro', grant);
}
