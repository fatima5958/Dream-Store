import type { Express } from 'express';
import type { V2Dependencies } from '../contracts.ts';
import { ApiError } from '../errors.ts';
import { authenticatedPrincipal, isVerifiedSuperAdmin } from './auth.ts';
import { requireSeller } from './policy.ts';

const allowedMethods = new Set(['jazzcash', 'easypaisa', 'manual_bank', 'upi_india', 'payoneer']);
const paths = (app: Express, route: string[], handler: any) => route.forEach(path => app.get(path, handler));

export function registerCommissionSettlementRoutes(app: Express, deps: V2Dependencies) {
  const finance = () => {
    if (!deps.finance?.commissionRecords || !deps.finance.issueCommissionInvoices ||
        !deps.finance.submitCommissionPayment || !deps.finance.reviewCommissionPayment || !deps.finance.disputeCommission ||
        !deps.finance.listCommissionDisputes || !deps.finance.resolveCommissionDispute) {
      throw new ApiError(501, 'commission/not-migrated', 'Commission settlement is not available in this V2 environment.');
    }
    return deps.finance;
  };

  const status = async (req: any, res: any) => {
    const principal = await authenticatedPrincipal(req, deps);
    const admin = isVerifiedSuperAdmin(principal, deps.adminUid);
    const requestedSellerId = String(req.query.sellerId || req.query.ownerId || '').trim();
    if (admin && requestedSellerId && !/^[A-Za-z0-9_-]{1,128}$/.test(requestedSellerId)) {
      throw new ApiError(422, 'commission/invalid-seller', 'Seller identity is invalid.');
    }
    if (!admin) {
      await requireSeller(principal, deps);
      if (requestedSellerId && requestedSellerId !== principal.uid) throw new ApiError(403, 'commission/owner-forbidden', 'You cannot view another Seller commission records.');
    }
    const sellerId = admin ? requestedSellerId || principal.uid : principal.uid;
    const repo = finance();
    const [records, orders, store] = await Promise.all([
      repo.commissionRecords!(sellerId), repo.listOrders(sellerId, false), repo.store(sellerId),
    ]);
    const invoices = records.invoices.sort((a, b) => Number(b.issuedAtMs) - Number(a.issuedAtMs));
    const payments = records.payments.sort((a, b) => String(b.createdAtIso).localeCompare(String(a.createdAtIso)));
    const adjustments = records.adjustments.sort((a, b) => String(b.createdAtIso).localeCompare(String(a.createdAtIso)));
    const eligible = orders.filter(order => order.sellerId === sellerId && order.paymentStatus === 'Paid' &&
      Number(order.grossAmountMinor) > 0 && ['Manually Verified by Seller', 'Gateway Verified'].includes(String(order.verificationMode)) &&
      order.commissionStatus !== 'reversed' && order.commissionStatus !== 'disputed' && !order.invoiceId);
    const unbilledCommissionMinor = eligible.reduce((sum, order) => sum + Number(order.platformCommissionMinor || 0), 0);
    const activeInvoices = invoices.filter(invoice => !['paid', 'voided'].includes(String(invoice.status)));
    const invoicedOutstandingMinor = activeInvoices.reduce((sum, invoice) => sum + Number(invoice.remainingBalanceMinor || 0), 0);
    const deadlines = activeInvoices.map(invoice => Number(invoice.dueAtMs)).filter(Number.isFinite);
    const deadline = deadlines.length ? Math.min(...deadlines) : null;
    const overdue = activeInvoices.find(invoice => Number(invoice.dueAtMs) < Date.now() &&
      !payments.some(payment => payment.invoiceId === invoice.invoiceId && payment.status === 'submitted'));
    const projectedInvoices = invoices.map(invoice => invoice.status === 'open' && Number(invoice.dueAtMs) < Date.now()
      ? { ...invoice, status: 'overdue' } : invoice);
    res.json({ sellerId, storeId: store?.storeId || store?.id || '', currency: invoices[0]?.currency || store?.currency || 'PKR',
      salesTowardNextInvoice: eligible.length % 5, invoiceThreshold: 5, totalVerifiedEligibleSales: orders.filter(order =>
        order.sellerId === sellerId && order.paymentStatus === 'Paid' && Number(order.grossAmountMinor) > 0 &&
        ['Manually Verified by Seller', 'Gateway Verified'].includes(String(order.verificationMode)) && order.commissionStatus !== 'reversed' && order.commissionStatus !== 'disputed').length,
      unbilledOrderNumbers: eligible.map(order => order.orderNumber), unbilledCommissionMinor,
      invoicedOutstandingMinor, totalOutstandingCommissionMinor: unbilledCommissionMinor + invoicedOutstandingMinor,
      totalPaidCommissionMinor: invoices.reduce((sum, invoice) => sum + Number(invoice.paidAmountMinor || 0), 0),
      totalAdjustedCommissionMinor: invoices.reduce((sum, invoice) => sum + Number(invoice.adjustedAmountMinor || 0), 0),
      nextPaymentDeadlineMs: deadline, nextPaymentDeadlineIso: deadline === null ? null : new Date(deadline).toISOString(),
      daysUntilDeadline: deadline === null ? null : Math.ceil((deadline - Date.now()) / 86400000),
      isRestricted: Boolean(overdue), restrictionReason: overdue ? `Commission invoice ${overdue.invoiceNumber} is overdue.` : null,
      restrictedFeatures: overdue ? ['add_product', 'publish_product', 'visual_store_builder', 'theme_customization'] : [],
      unrestrictedFeatures: ['public_storefront_visibility', 'existing_product_purchases', 'buyer_checkout', 'payment_processing', 'existing_orders', 'digital_product_downloads', 'seller_access_to_orders', 'seller_access_to_commission_payments', 'customer_support_and_refunds'],
      invoices: projectedInvoices, payments, adjustments });
  };
  paths(app, ['/api/commission/status', '/api/commissions/invoices'], (req: any, res: any, next: any) => status(req, res).catch(next));

  app.post('/api/commission/invoices/issue', (req, res, next) => (async () => {
    const principal = await authenticatedPrincipal(req, deps); await requireSeller(principal, deps);
    const invoices = await finance().issueCommissionInvoices!(principal.uid);
    res.json({ ok: true, invoices, commissionSummary: await statusSummary(principal.uid, finance()) });
  })().catch(next));

  const overview = async (req: any, res: any) => {
    const principal = await authenticatedPrincipal(req, deps);
    if (!isVerifiedSuperAdmin(principal, deps.adminUid)) throw new ApiError(403, 'auth/admin-forbidden', 'This account is not an administrator.');
    const records = await finance().commissionRecords!();
    // This migrated view intentionally returns no fabricated store or traffic
    // metrics; the existing Admin UI updates only fields present in the reply.
    res.json({ settings: { platformCommissionBps: 500 },
      invoices: records.invoices.sort((a, b) => Number(b.issuedAtMs) - Number(a.issuedAtMs)),
      payments: records.payments.sort((a, b) => String(b.createdAtIso).localeCompare(String(a.createdAtIso))),
      adjustments: records.adjustments });
  };
  paths(app, ['/api/commission/admin-overview', '/api/commission/admin/overview'], (req: any, res: any, next: any) => overview(req, res).catch(next));

  app.post('/api/commission/submit-payment', (req, res, next) => (async () => {
    const principal = await authenticatedPrincipal(req, deps); await requireSeller(principal, deps);
    const invoiceId = String(req.body?.invoiceId || '').trim();
    const paymentMethod = String(req.body?.paymentMethod || 'bank_transfer').trim().toLowerCase();
    const paymentReference = String(req.body?.paymentReference || '').trim();
    const proofNote = String(req.body?.proofNote || '').trim();
    const amountMinor = req.body?.amountMinor;
    if (!/^[A-Za-z0-9_-]{3,128}$/.test(invoiceId) || !allowedMethods.has(paymentMethod) ||
        paymentReference.length < 3 || paymentReference.length > 160 || proofNote.length > 500 ||
        (amountMinor !== undefined && (!Number.isSafeInteger(Number(amountMinor)) || Number(amountMinor) <= 0))) {
      throw new ApiError(422, 'commission/invalid-proof', 'Enter a valid invoice, manual payment method, reference and optional integer amount.');
    }
    const committed = await finance().submitCommissionPayment!({ invoiceId, sellerId: principal.uid,
      amountMinor: amountMinor === undefined ? undefined : Number(amountMinor), paymentMethod, paymentReference, proofNote });
    const summary = await statusSummary(principal.uid, finance());
    res.json({ ok: true, payment: committed.payment, invoice: committed.invoice, commissionSummary: summary });
  })().catch(next));

  const review = (req: any, res: any, next: any) => (async () => {
    const principal = await authenticatedPrincipal(req, deps);
    if (!isVerifiedSuperAdmin(principal, deps.adminUid)) throw new ApiError(403, 'auth/admin-forbidden', 'Only the verified Super Admin may review commission settlement.');
    const paymentId = String(req.body?.paymentId || '').trim(); const invoiceId = String(req.body?.invoiceId || '').trim();
    const decision = req.body?.decision;
    if (!/^[A-Za-z0-9_-]{3,128}$/.test(paymentId) || !/^[A-Za-z0-9_-]{3,128}$/.test(invoiceId) || !['approve', 'reject'].includes(decision)) {
      throw new ApiError(422, 'commission/invalid-review', 'A payment, invoice and explicit approve/reject decision are required.');
    }
    if (decision === 'approve' && req.body?.fundsConfirmed !== true) throw new ApiError(422, 'commission/evidence-required', 'Independently confirm cleared funds against external bank or wallet evidence.');
    const result = await finance().reviewCommissionPayment!({ paymentId, invoiceId, decision,
      fundsConfirmed: req.body?.fundsConfirmed === true, actorUid: principal.uid, note: String(req.body?.note || '') });
    const summary = await statusSummary(result.invoice.sellerId, finance());
    res.json({ ok: true, invoice: result.invoice, payment: result.payment,
      message: decision === 'approve' ? 'Cleared funds recorded after Super Admin attestation.' : 'Payment proof rejected.', commissionSummary: summary });
  })().catch(next);
  for (const path of ['/api/commission/verify-payment', '/api/admin/commission/verify-payment', '/api/commissions/verify-payment']) app.post(path, review);

  app.post('/api/ledger/commission-status', (req, res, next) => (async () => {
    const principal = await authenticatedPrincipal(req, deps);
    const status = String(req.body?.newCommissionStatus || '').trim();
    const orderNumber = String(req.body?.orderNumber || '').trim();
    const note = String(req.body?.note || '').trim();
    if (status === 'paid' || status === 'reversed') throw new ApiError(409, 'commission/dedicated-workflow-required', 'Settlement and refunds require their dedicated audited workflows.');
    if (status !== 'disputed' || note.length < 10 || note.length > 500) throw new ApiError(422, 'commission/invalid-dispute', 'A dispute requires at least 10 characters and cannot change settlement state.');
    await requireSeller(principal, deps);
    const changed = await finance().disputeCommission!(orderNumber, principal.uid, note);
    res.json({ ok: true, orderNumber, disputeId: changed.disputeId, commissionStatus: changed.commissionStatus,
      commissionSummary: await statusSummary(principal.uid, finance()) });
  })().catch(next));

  app.get('/api/commission/admin/disputes', (req, res, next) => (async () => {
    const principal = await authenticatedPrincipal(req, deps);
    if (!isVerifiedSuperAdmin(principal, deps.adminUid)) throw new ApiError(403, 'auth/admin-forbidden', 'Only the verified Super Admin may review commission disputes.');
    const rawLimit = req.query.limit === undefined ? 100 : Number(req.query.limit);
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 200) throw new ApiError(400, 'commission/invalid-limit', 'Limit must be an integer from 1 to 200.');
    const sellerId = String(req.query.sellerId || '').trim();
    if (sellerId && !/^[A-Za-z0-9_-]{1,128}$/.test(sellerId)) throw new ApiError(400, 'commission/invalid-seller', 'Seller identity is invalid.');
    const disputes = await finance().listCommissionDisputes!(rawLimit);
    res.json({ disputes: disputes.filter(item => !sellerId || item.sellerId === sellerId)
      .sort((a, b) => String(b.submittedAtIso || '').localeCompare(String(a.submittedAtIso || ''))) });
  })().catch(next));

  app.post('/api/commission/admin/disputes/resolve', (req, res, next) => (async () => {
    const principal = await authenticatedPrincipal(req, deps);
    if (!isVerifiedSuperAdmin(principal, deps.adminUid)) throw new ApiError(403, 'auth/admin-forbidden', 'Only the verified Super Admin may resolve commission disputes.');
    const disputeId = String(req.body?.disputeId || '').trim();
    const decision = req.body?.decision;
    const explanation = String(req.body?.explanation || '').trim();
    if (!/^cd-[a-f0-9]{32}$/.test(disputeId) || !['approve', 'reject'].includes(decision) || explanation.length < 10 || explanation.length > 1000) {
      throw new ApiError(400, 'commission/invalid-dispute-decision', 'Provide a dispute ID, approve/reject decision and explanation of 10 to 1000 characters.');
    }
    const dispute = await finance().resolveCommissionDispute!({ disputeId, decision, actorUid: principal.uid, explanation });
    res.json({ ok: true, dispute, reconciliationRequired: Number(dispute.reconciliationRequiredMinor || 0) > 0 });
  })().catch(next));

  const updateCommissionConfig = (req: any, res: any, next: any) => (async () => {
    const principal = await authenticatedPrincipal(req, deps);
    if (!isVerifiedSuperAdmin(principal, deps.adminUid)) throw new ApiError(403, 'auth/admin-forbidden', 'Only the verified Super Admin may update platform settings.');
    const bps = Number(req.body?.newCommissionBps ?? req.body?.commissionBps);
    if (!Number.isInteger(bps) || bps !== 500) throw new ApiError(409, 'commission/rate-locked', 'The current platform commission is fixed at 500 basis points (5%).');
    res.json({ ok: true, platformCommissionBps: 500, commissionPercentage: '5.00%', updatedByUid: principal.uid });
  })().catch(next);
  app.post('/api/admin/commission-config', updateCommissionConfig);
  app.post('/api/admin/commission-rate', updateCommissionConfig);
}

export async function statusSummary(sellerId: string, finance: NonNullable<V2Dependencies['finance']>) {
  const [records, orders, store] = await Promise.all([finance.commissionRecords!(sellerId), finance.listOrders(sellerId, false), finance.store(sellerId)]);
  const eligible = orders.filter(order => order.sellerId === sellerId && order.paymentStatus === 'Paid' && Number(order.grossAmountMinor) > 0 &&
    ['Manually Verified by Seller', 'Gateway Verified'].includes(String(order.verificationMode)) && !order.invoiceId &&
    order.commissionStatus !== 'reversed' && order.commissionStatus !== 'disputed');
  const outstanding = records.invoices.filter(invoice => !['paid', 'voided'].includes(String(invoice.status)));
  const deadline = outstanding.length ? Math.min(...outstanding.map(invoice => Number(invoice.dueAtMs)).filter(Number.isFinite)) : null;
  return { sellerId, storeId: store?.storeId || store?.id || '', currency: records.invoices[0]?.currency || store?.currency || 'PKR',
    salesTowardNextInvoice: eligible.length % 5, invoiceThreshold: 5, totalVerifiedEligibleSales: eligible.length,
    unbilledOrderNumbers: eligible.map(order => order.orderNumber), unbilledCommissionMinor: eligible.reduce((sum, order) => sum + Number(order.platformCommissionMinor || 0), 0),
    invoicedOutstandingMinor: outstanding.reduce((sum, invoice) => sum + Number(invoice.remainingBalanceMinor || 0), 0),
    totalOutstandingCommissionMinor: eligible.reduce((sum, order) => sum + Number(order.platformCommissionMinor || 0), 0) + outstanding.reduce((sum, invoice) => sum + Number(invoice.remainingBalanceMinor || 0), 0),
    totalPaidCommissionMinor: records.invoices.reduce((sum, invoice) => sum + Number(invoice.paidAmountMinor || 0), 0),
    totalAdjustedCommissionMinor: records.invoices.reduce((sum, invoice) => sum + Number(invoice.adjustedAmountMinor || 0), 0),
    nextPaymentDeadlineMs: deadline, nextPaymentDeadlineIso: deadline === null ? null : new Date(deadline).toISOString(),
    daysUntilDeadline: deadline === null ? null : Math.ceil((deadline - Date.now()) / 86400000),
    isRestricted: outstanding.some(invoice => Number(invoice.dueAtMs) < Date.now() && !records.payments.some(payment => payment.invoiceId === invoice.invoiceId && payment.status === 'submitted')),
    restrictionReason: null, restrictedFeatures: [], unrestrictedFeatures: [], invoices: records.invoices, payments: records.payments, adjustments: records.adjustments };
}
