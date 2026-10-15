import type { Express } from 'express';
import type { V2Dependencies } from '../contracts.ts';
import { ApiError } from '../errors.ts';
import { authenticatedPrincipal } from './auth.ts';
import { requireSeller } from './policy.ts';

const stringFields: Record<string, number> = { jazzCashMerchantId: 120, easypaisaStoreId: 120, upiId: 120,
  bankTransferInstructions: 1000, paymentLinkUrl: 300, payoneerReceivingEmail: 254,
  payoneerRequestLink: 300, payoneerReceivingAccountDetails: 500, whatsappNotificationNumber: 40, stripeAccountId: 120 };
const boolFields = ['jazzCashEnabled', 'easypaisaEnabled', 'payoneerEnabled', 'whatsappNotificationsEnabled'];
const usable = (value: unknown) => {
  const text = String(value || '').trim();
  return text.length >= 3 && !/(your_|placeholder|dummy|demo|test_key|example|changeme|undefined)/i.test(text);
};
function clean(raw: Record<string, any>, ownerId: string, storeId: string, email: string) {
  const result: Record<string, any> = { ownerId, storeId, email: email.slice(0, 254) };
  for (const [key, max] of Object.entries(stringFields)) {
    const value = raw[key] ?? '';
    if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) {
      throw new ApiError(422, 'payment-settings/invalid-field', `Invalid ${key}.`);
    }
    result[key] = value.trim();
    if (value.trim() && /(your_|placeholder|dummy|demo|test_key|example|changeme|undefined)/i.test(value)) throw new ApiError(422, 'payment-settings/placeholder-value', `Replace the placeholder value in ${key}.`);
  }
  for (const key of ['paymentLinkUrl', 'payoneerRequestLink']) if (result[key]) {
    let parsed: URL;
    try { parsed = new URL(result[key]); } catch { throw new ApiError(422, 'payment-settings/invalid-url', `Invalid ${key}.`); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new ApiError(422, 'payment-settings/invalid-url', `${key} must be an HTTPS URL.`);
  }
  for (const key of boolFields) {
    if (raw[key] !== undefined && typeof raw[key] !== 'boolean') throw new ApiError(422, 'payment-settings/invalid-field', `Invalid ${key}.`);
    result[key] = raw[key] === true;
  }
  // Automated gateways remain disabled in V2 until a separately authorized integration exists.
  result.stripeEnabled = false;
  const methods = configuredMethods(result);
  result.configuredMethods = methods;
  result.paymentConfigured = methods.length > 0;
  result.updatedAtIso = new Date().toISOString();
  return result;
}
export function configuredMethods(s: Record<string, any> | null | undefined): string[] {
  if (!s) return [];
  const methods: string[] = [];
  if (s.jazzCashEnabled !== false && usable(s.jazzCashMerchantId)) methods.push('jazzcash');
  if (s.easypaisaEnabled !== false && usable(s.easypaisaStoreId)) methods.push('easypaisa');
  if (/^[\w.+-]+@[\w.-]+$/.test(String(s.upiId || '').trim()) && usable(s.upiId)) methods.push('upi_india');
  if (String(s.bankTransferInstructions || '').trim().length >= 5 && usable(s.bankTransferInstructions)) methods.push('manual_bank');
  if (s.payoneerEnabled && (usable(s.payoneerReceivingEmail) || usable(s.payoneerRequestLink) || usable(s.payoneerReceivingAccountDetails))) methods.push('payoneer');
  return methods;
}
export function buyerInstructions(storeId: string, s: Record<string, any> | null) {
  const methods = configuredMethods(s);
  return { storeId, paymentConfigured: methods.length > 0, configuredMethods: methods,
    setupMessage: methods.length ? '' : 'Paid checkout is disabled until the seller configures manual payment instructions.',
    jazzCashMerchantId: methods.includes('jazzcash') ? s?.jazzCashMerchantId : '', jazzCashEnabled: methods.includes('jazzcash'),
    easypaisaStoreId: methods.includes('easypaisa') ? s?.easypaisaStoreId : '', easypaisaEnabled: methods.includes('easypaisa'),
    upiId: methods.includes('upi_india') ? s?.upiId : '', bankTransferInstructions: methods.includes('manual_bank') ? s?.bankTransferInstructions : '',
    payoneerEnabled: methods.includes('payoneer'), payoneerReceivingEmail: methods.includes('payoneer') ? s?.payoneerReceivingEmail : '',
    payoneerRequestLink: methods.includes('payoneer') ? s?.payoneerRequestLink : '',
    payoneerReceivingAccountDetails: methods.includes('payoneer') ? s?.payoneerReceivingAccountDetails : '', paymentLinkUrl: '', whatsappNotificationNumber: '' };
}
export function registerPaymentSettingsRoutes(app: Express, deps: V2Dependencies) {
  const get = async (req: any, res: any) => {
    const principal = await authenticatedPrincipal(req, deps);
    const own = await deps.finance?.store(principal.uid);
    if (!principal.emailVerified || !own || own.ownerId !== principal.uid) throw new ApiError(403, 'payment-settings/seller-required', 'Only the verified store owner may view private payment settings.');
    const requested = String(req.params.storeId || req.query.storeId || own.storeId);
    if (requested !== own.storeId && requested !== own.storeSlug) throw new ApiError(403, 'payment-settings/owner-forbidden', 'Cannot access another seller payment settings.');
    const saved = await deps.finance!.paymentSettings(principal.uid) || clean({}, principal.uid, own.storeId, principal.email);
    res.json({ ok: true, settings: saved });
  };
  for (const path of ['/api/payment-settings', '/api/payment-settings/:storeId', '/api/seller-settings', '/api/seller-settings/:storeId']) app.get(path, (req, res, next) => { get(req, res).catch(next); });
  app.post('/api/payment-settings/save', (req, res, next) => (async () => {
    const principal = await authenticatedPrincipal(req, deps); await requireSeller(principal, deps);
    const store = await deps.finance?.store(principal.uid);
    if (!store || store.ownerId !== principal.uid || store.status !== 'Active') throw new ApiError(403, 'payment-settings/owner-forbidden', 'Only the verified owner of an active store may save payment settings.');
    if (req.body?.sellerId && req.body.sellerId !== principal.uid || req.body?.ownerId && req.body.ownerId !== principal.uid) throw new ApiError(403, 'payment-settings/owner-forbidden', 'Seller identity must match the signed-in account.');
    const result = await deps.finance!.savePaymentSettings(principal.uid, store.storeId, clean(req.body || {}, principal.uid, store.storeId, principal.email));
    res.json({ ok: true, settings: result });
  })().catch(next));
  app.post('/api/seller-settings', (req, res, next) => (async () => {
    const principal = await authenticatedPrincipal(req, deps); await requireSeller(principal, deps);
    const store = await deps.finance?.store(principal.uid);
    if (!store || store.ownerId !== principal.uid || store.status !== 'Active') throw new ApiError(403, 'payment-settings/owner-forbidden', 'Only the verified owner of an active store may save payment settings.');
    const result = await deps.finance!.savePaymentSettings(principal.uid, store.storeId, clean(req.body || {}, principal.uid, store.storeId, principal.email));
    res.json({ ok: true, settings: result });
  })().catch(next));
  app.get('/api/checkout/payment-instructions/:storeId', (req, res, next) => (async () => {
    const store = await deps.finance?.store(String(req.params.storeId));
    if (!store || store.status !== 'Active') throw new ApiError(404, 'store/not-found', 'Store not found.');
    const settings = await deps.finance!.paymentSettings(store.ownerId);
    const instructions = buyerInstructions(store.storeId, settings);
    res.json({ ...instructions, instructions });
  })().catch(next));
}
