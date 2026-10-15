import type { Express, Request, Response } from 'express';
import type { Principal, V2Dependencies } from '../contracts.ts';
import { ApiError } from '../errors.ts';
import { authenticatedPrincipal, isVerifiedSuperAdmin } from './auth.ts';
import { requireSeller, validId } from './policy.ts';
import { COMMISSION_RATE_BPS } from './commissions.ts';

type Handler = (req: Request, res: Response) => Promise<void>;
const route = (handler: Handler) => (req: Request, res: Response, next: (error?: unknown) => void) => {
  Promise.resolve(handler(req, res)).catch(next);
};

export function registerCommissionLifecycleRoutes(app: Express, deps: V2Dependencies) {
  const repo = () => {
    if (!deps.commissions) throw new ApiError(503, 'commission/unavailable', 'Commission service is unavailable.');
    return deps.commissions;
  };
  const requireAdmin = async (req: Request): Promise<Principal> => {
    const principal = await authenticatedPrincipal(req, deps);
    if (!isVerifiedSuperAdmin(principal, deps.adminUid)) throw new ApiError(403, 'auth/admin-forbidden', 'Only the verified Super Admin may do this.');
    return principal;
  };

  // Reads: a Seller sees only their own balances; the Super Admin may inspect a named Seller.
  const status = route(async (req, res) => {
    const principal = await authenticatedPrincipal(req, deps);
    if (!principal.emailVerified) throw new ApiError(403, 'auth/email-not-verified', 'Verify your email first.');
    const admin = isVerifiedSuperAdmin(principal, deps.adminUid);
    const asked = String(req.query.sellerId || '').trim();
    if (asked && !validId(asked)) throw new ApiError(422, 'request/invalid-id', 'Invalid seller ID.');
    if (asked && asked !== principal.uid && !admin) throw new ApiError(403, 'commission/forbidden', 'You can only view your own commission status.');
    if (!admin) {
      const profile = await deps.profiles.find(principal);
      if (!profile || profile.role !== 'seller') throw new ApiError(403, 'store/seller-required', 'Commission status is available to Sellers.');
    }
    res.json(await repo().summary(asked || principal.uid));
  });
  app.get('/api/commission/status', status);
  app.get('/api/commissions/invoices', status);

  app.post('/api/commission/submit-payment', route(async (req, res) => {
    const principal = await authenticatedPrincipal(req, deps);
    // Administrators review evidence; they never submit it on a Seller's behalf.
    if (isVerifiedSuperAdmin(principal, deps.adminUid)) throw new ApiError(403, 'commission/admin-cannot-submit', 'Only the owning Seller can submit commission payment evidence.');
    await requireSeller(principal, deps);
    const body = req.body || {};
    if (body.sellerId && String(body.sellerId).trim() !== principal.uid) throw new ApiError(403, 'commission/forbidden', 'You cannot submit commission proof for another seller.');
    const invoiceId = String(body.invoiceId || '').trim();
    const reference = String(body.paymentReference || '').trim();
    const method = String(body.paymentMethod ?? 'bank_transfer').trim();
    const proofNote = String(body.proofNote ?? '');
    if (!/^[a-zA-Z0-9_-]{3,128}$/.test(invoiceId) || reference.length < 3 || reference.length > 160 ||
        method.length < 2 || method.length > 60 || proofNote.length > 500) {
      throw new ApiError(400, 'commission/invalid-input', 'Valid invoice, transfer reference and payment method are required.');
    }
    const amountMinor = body.amountMinor === undefined ? undefined : Number(body.amountMinor);
    const { payment, invoice } = await repo().submitPayment({ invoiceId, sellerUid: principal.uid, amountMinor, method, reference, proofNote });
    res.json({ ok: true, payment, invoice, commissionSummary: await repo().summary(invoice.sellerId) });
  }));

  const verify = route(async (req, res) => {
    const admin = await requireAdmin(req);
    if (!deps.allowWrites) throw new ApiError(503, 'backend/staging-readonly', 'Settlement changes require isolated staging.');
    const { paymentId, invoiceId, decision, fundsConfirmed, note } = req.body || {};
    if (!validId(String(paymentId || '')) || String(paymentId).length < 3 || (decision !== 'approve' && decision !== 'reject')) {
      throw new ApiError(400, 'commission/invalid-input', 'A submitted payment ID and an explicit approve/reject decision are required.');
    }
    // Uploading evidence never settles anything: approval needs an explicit statement check by the admin.
    if (decision === 'approve' && fundsConfirmed !== true) {
      throw new ApiError(400, 'commission/funds-confirmation-required', 'Confirm receipt of cleared funds on the actual bank/wallet statement before approving.');
    }
    const result = await repo().reviewPayment({ paymentId: String(paymentId), invoiceId: invoiceId ? String(invoiceId) : undefined,
      decision, adminUid: admin.uid, adminEmail: admin.email, note: String(note ?? '') });
    res.json({ ok: true, ...result, message: decision === 'approve' ? 'Cleared funds recorded successfully.' : 'Payment proof rejected.',
      commissionSummary: await repo().summary(result.invoice.sellerId) });
  });
  app.post('/api/commission/verify-payment', verify);
  app.post('/api/admin/commission/verify-payment', verify);
  app.post('/api/commissions/verify-payment', verify);

  const overview = route(async (req, res) => { await requireAdmin(req); res.json(await repo().adminOverview()); });
  app.get('/api/commission/admin-overview', overview);
  app.get('/api/commission/admin/overview', overview);

  // Gateways are not implemented in V2. Report that truthfully instead of reading credentials.
  app.get('/api/payments/gateway-status', route(async (_req, res) => {
    res.json({ jazzcashConfigured: false, easypaisaConfigured: false, razorpayConfigured: false, stripeConfigured: false,
      payoneerConfigured: false, payoneerApiEnabled: false, payoneerManualVerificationPreserved: true,
      paidCheckoutEnabled: Boolean(deps.allowWrites && deps.paidCheckoutEnabled && process.env.NODE_ENV !== 'production'),
      payoneerMode: 'manual_settlement', emailConfigured: false, platformCommissionBps: COMMISSION_RATE_BPS,
      serverTime: new Date().toISOString() });
  }));

  // No gateway adapter exists: never acknowledge or simulate a payment event.
  app.post('/api/webhooks/:provider', route(async () => {
    throw new ApiError(503, 'webhooks/disabled', 'Automatic payment webhooks are not enabled. Use the verified manual payment workflow.');
  }));
}
