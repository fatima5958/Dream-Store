import type { Express } from 'express';
import type { V2Dependencies } from '../contracts.ts';
import { ApiError } from '../errors.ts';
import { authenticatedPrincipal, isVerifiedSuperAdmin } from './auth.ts';
import { validateAdminStorePatch } from './admin-management.ts';

export function registerAdminManagementRoutes(app: Express, deps: V2Dependencies) {
  const management = () => {
    if (!deps.management) throw new ApiError(501, 'admin/not-migrated', 'Admin management is unavailable in this V2 environment.');
    return deps.management;
  };
  const admin = async (req: any) => {
    const p = await authenticatedPrincipal(req, deps);
    if (!isVerifiedSuperAdmin(p, deps.adminUid)) throw new ApiError(403, 'auth/admin-forbidden', 'Only the verified Super Admin can manage stores.');
    return p;
  };

  app.post('/api/admin/stores/status', (req: any, res: any, next: any) => (async () => {
    const principal = await admin(req);
    const storeId = String(req.body?.storeId || '').trim();
    const status = String(req.body?.status || '').trim().toLowerCase();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(storeId) || !['active', 'pending', 'suspended'].includes(status)) {
      throw new ApiError(400, 'admin/invalid-store-status', 'Valid storeId and status are required.');
    }
    const patch = validateAdminStorePatch(status === 'active' ? 'activate' : status === 'suspended' ? 'suspend' : 'pending', req.body || {});
    const saved = await management().updateStore(storeId, patch, principal.uid, `STORE_STATUS_${status.toUpperCase()}`);
    if (!saved) throw new ApiError(404, 'admin/store-not-found', 'Store not found.');
    res.json({ ok: true, storeId, status: saved.status, updatedByUid: principal.uid });
  })().catch(next));

  app.post('/api/admin/stores/control', (req: any, res: any, next: any) => (async () => {
    const principal = await admin(req);
    const body = req.body || {};
    const action = String(body.action || '').trim().toLowerCase();
    if (['activate_all_stores', 'approve_all_pending_orders', 'approve_all'].includes(action)) {
      throw new ApiError(409, 'admin/bulk-action-disabled', 'Bulk moderation and financial actions are disabled. Review each record individually.');
    }
    if (action === 'grant_pro' || action === 'revoke_pro') {
      const storeId = String(body.storeId || '').trim();
      const sellerId = String(body.sellerId || body.targetSellerId || '').trim();
      if (!storeId && !sellerId) throw new ApiError(400, 'admin/seller-required', 'Seller or store identity is required.');
      if ((storeId && !/^[A-Za-z0-9_-]{1,128}$/.test(storeId)) || (sellerId && !/^[A-Za-z0-9_-]{1,128}$/.test(sellerId))) throw new ApiError(400, 'admin/invalid-target', 'Seller or store identity is invalid.');
      const result = await management().grantPro({ sellerId: sellerId || undefined, storeId: storeId || undefined,
        grantPro: action === 'grant_pro', actorUid: principal.uid });
      res.json({ ok: true, action, targetSellerId: result.sellerId, storeId: storeId || undefined,
        plan: result.plan, hasProEntitlement: result.plan === 'Pro', updatedByUid: principal.uid,
        updatedStoreCount: result.storeIds.length });
      return;
    }
    const storeId = String(body.storeId || '').trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(storeId)) throw new ApiError(400, 'admin/invalid-store-id', 'Valid storeId is required.');
    const updates = body.updates && typeof body.updates === 'object' && !Array.isArray(body.updates) ? { ...body.updates } : body.updates;
    const requestedPlan = action === 'update_store' && updates && typeof updates === 'object' ? updates.plan : undefined;
    if (requestedPlan !== undefined) {
      if (!['Pro', 'Free'].includes(String(requestedPlan))) throw new ApiError(409, 'admin/invalid-plan', 'Only the existing Free and Pro plans are supported.');
      delete updates.plan;
    }
    const patch = requestedPlan !== undefined && updates && typeof updates === 'object' && Object.keys(updates).length === 0
      ? {} : validateAdminStorePatch(action, { ...body, updates });
    let saved: Record<string, any> | null = null;
    if (Object.keys(patch).length) saved = await management().updateStore(storeId, patch, principal.uid, `STORE_${action.toUpperCase()}`);
    if (requestedPlan !== undefined) {
      const updated = await management().grantPro({ storeId, grantPro: requestedPlan === 'Pro', actorUid: principal.uid });
      const current = saved || await deps.stores?.find(storeId) || { storeId, ownerId: updated.sellerId };
      saved = { ...current, plan: updated.plan };
    }
    if (!saved) throw new ApiError(404, 'admin/store-not-found', 'Store not found.');
    res.json({ ok: true, action, store: { storeId, storeName: saved.storeName, currency: saved.currency,
      theme: saved.theme, status: saved.status === 'Active' ? 'active' : 'suspended', planId: saved.plan === 'Pro' ? 'pro' : 'free' } });
  })().catch(next));
}
