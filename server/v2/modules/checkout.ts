import { createHmac, randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { V2Dependencies } from '../contracts.ts';
import { ApiError } from '../errors.ts';
import { authenticatedPrincipal } from './auth.ts';
import { configuredMethods } from './payment-settings.ts';
import { commissionBreakdown } from './commissions.ts';

const exchange: Record<string, number> = { USD: 1, PKR: 278, INR: 84, GBP: .78, EUR: .92, AED: 3.67, SAR: 3.75, CAD: 1.38, AUD: 1.52 };
const minor = (value: number) => Math.round(value * 100);
export function registerCheckoutRoutes(app: Express, deps: V2Dependencies) {
  app.post('/api/checkout/validate-and-prepare', (req, res, next) => (async () => {
    const buyer = await authenticatedPrincipal(req, deps);
    if (!deps.allowWrites) throw new ApiError(503, 'backend/staging-readonly', 'Financial writes are disabled outside isolated staging.');
    if (!buyer.emailVerified) throw new ApiError(403, 'auth/email-not-verified', 'Verify your email before checkout.');
    const profile = await deps.profiles.find(buyer);
    if (!profile || !profile.onboardingCompleted) throw new ApiError(403, 'auth/onboarding-required', 'Complete account onboarding first.');
    const body = req.body || {};
    if (!buyer.email || (body.customerEmail && String(body.customerEmail).trim().toLowerCase() !== buyer.email.toLowerCase())) throw new ApiError(403, 'checkout/email-mismatch', 'Use your verified account email for delivery.');
    const key = String(body.idempotencyKey || '');
    if (!/^[A-Za-z0-9_-]{8,200}$/.test(key)) throw new ApiError(422, 'checkout/invalid-idempotency-key', 'A valid checkout idempotency key is required.');
    if (!Array.isArray(body.items) || body.items.length !== 1 || Number(body.items[0]?.quantity ?? 1) !== 1) throw new ApiError(422, 'checkout/invalid-items', 'Check out one digital product at a time.');
    const productId = String(body.items[0].id || '');
    const product = (await deps.products?.list(String(body.storeId || ''), null))?.find(p => p.id === productId);
    // Catalog list is intentionally public-only, so it independently enforces published visibility.
    if (!product) throw new ApiError(404, 'product/not-found', 'Published product not found.');
    const store = await deps.finance?.store(String(product.storeId || ''));
    if (!store || store.status !== 'Active' || store.ownerId !== product.ownerId) throw new ApiError(404, 'store/not-found', 'Store is unavailable.');
    const currency = String(body.currency || '');
    if (!Object.hasOwn(exchange, currency)) throw new ApiError(422, 'checkout/invalid-currency', 'Unsupported currency.');
    let amount = product.isFree ? 0 : currency === 'PKR' ? Number(product.pricePkr) : currency === 'USD' ? Number(product.priceUsd) : Number(product.priceUsd) * exchange[currency];
    amount = Math.round(amount * 100) / 100;
    const amountMinor = minor(amount);
    const method = String(body.paymentMethod || '');
    const isFree = amountMinor === 0;
    if (isFree && method !== 'free_instant') throw new ApiError(422, 'checkout/free-method-required', 'Free products must use free_instant checkout.');
    if (!isFree) {
      // Checkout remains disabled in production and unless staging explicitly opts in.
      if (!deps.allowWrites || !deps.paidCheckoutEnabled || process.env.NODE_ENV === 'production') throw new ApiError(503, 'checkout/paid-disabled', 'Paid checkout is disabled. No payment was requested or recorded.');
      const settings = await deps.finance!.paymentSettings(String(store.ownerId));
      if (!configuredMethods(settings).includes(method)) throw new ApiError(422, 'checkout/payment-method-unavailable', 'Selected manual payment method is not configured for this store.');
      if (method === 'stripe_card' || method === 'razorpay_inr') throw new ApiError(403, 'checkout/gateway-disabled', 'Automated payment gateways are disabled.');
      if (String(body.paymentReference || '').trim().length < 3 || String(body.paymentReference).length > 200) throw new ApiError(422, 'checkout/payment-reference-required', 'Enter a transaction reference for Seller verification.');
    }
    const orderNumber = `DS-${Date.now().toString().slice(-6)}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const orderId = `order-${randomUUID()}`;
    const expiresAtMs = Date.now() + 7 * 86400000;
    const commission = commissionBreakdown(amountMinor, currency, method);
    const order = { orderNumber, orderId, storeId: store.storeId, sellerId: store.ownerId, buyerId: buyer.uid,
      primaryProductId: productId, customerName: String(body.customerName || buyer.displayName || 'Buyer').slice(0, 120),
      customerEmail: buyer.email, itemTitlesSummary: String(product.title || 'Digital Product').slice(0, 1000), itemCount: 1,
      subtotal: amount, totalAmount: amount, ...commission,
      paymentMethod: method, paymentReference: isFree ? 'FREE-INSTANT' : String(body.paymentReference).trim().slice(0, 200),
      paymentStatus: isFree ? 'Paid' : 'Pending', verificationMode: isFree ? 'Instant Free' : 'Unverified',
      commissionStatus: isFree ? 'not_applicable' : 'outstanding', payoutStatus: isFree ? 'Not Applicable (Free)' : 'Pending Payment Verification',
      downloadCount: 0, maxDownloads: 5, expiresAtMs, createdAtIso: new Date().toISOString(), updatedAtIso: new Date().toISOString(),
      idempotencyKey: key, downloadTokenId: randomUUID(), paymentAudit: [{ action: 'ORDER_CREATED', actorUid: buyer.uid, atIso: new Date().toISOString() }] };
    const committed = await deps.finance!.createOrder(order);
    const token = createDownloadToken(committed.order, deps.downloadTokenSecret || '');
    res.status(committed.duplicate ? 200 : 201).json({ orderId: committed.order.orderId, orderNumber: committed.order.orderNumber,
      storeId: committed.order.storeId, sellerId: committed.order.sellerId, calculatedSubtotal: amount, calculatedTotal: amount,
      currency, initialPaymentStatus: committed.order.paymentStatus, verificationMode: committed.order.verificationMode,
      commissionStatus: committed.order.commissionStatus, downloadToken: isFree ? token : 'LOCKED-PENDING-VERIFICATION',
      expiresAtMs: committed.order.expiresAtMs, maxDownloads: 5, commissionBreakdown: commission, payoutStatus: committed.order.payoutStatus,
      gatewayNotice: isFree ? 'Free digital product verified. Instant download unlocked.' : 'Order recorded pending Seller payment verification. A transaction reference is not proof of payment.',
      ...(committed.duplicate ? { duplicate: true } : {}) });
  })().catch(next));
}

export function createDownloadToken(order: Record<string, any>, secret: string) {
  if (secret.length < 32) throw new ApiError(503, 'downloads/signing-unavailable', 'Secure download signing is not configured.');
  const payload = Buffer.from(JSON.stringify({ orderNumber: order.orderNumber, productId: order.primaryProductId,
    buyerId: order.buyerId, tokenId: order.downloadTokenId, exp: order.expiresAtMs })).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
