import { ApiError } from '../errors.ts';
import type { Express } from 'express';
import type { V2Dependencies } from '../contracts.ts';

/** DreamStore's V1 accounting convention: all supported currencies have 2 minor digits. */
export const COMMISSION_RATE_BPS = 500;
export function commissionBreakdown(grossAmountMinor: number, currency: string, paymentMethod: string) {
  if (!Number.isSafeInteger(grossAmountMinor) || grossAmountMinor < 0) {
    throw new ApiError(422, 'commission/invalid-amount', 'Order amount must be a non-negative integer in minor units.');
  }
  const platformCommissionMinor = Math.floor((grossAmountMinor * COMMISSION_RATE_BPS + 5000) / 10000);
  const sellerShareBeforeFeesMinor = grossAmountMinor - platformCommissionMinor;
  return { currency, commissionRateBps: COMMISSION_RATE_BPS, grossAmountMinor, platformCommissionMinor,
    sellerShareBeforeFeesMinor, gatewayFeeMinor: 0, sellerNetEarningsMinor: sellerShareBeforeFeesMinor };
}

export function commissionEntry(order: Record<string, any>, now = new Date()) {
  return { entryId: String(order.orderNumber), orderId: order.orderId, orderNumber: order.orderNumber,
    storeId: order.storeId, sellerId: order.sellerId, buyerId: order.buyerId,
    ...commissionBreakdown(order.grossAmountMinor, order.currency, order.paymentMethod),
    status: order.grossAmountMinor > 0 ? 'outstanding' : 'not_applicable', createdAt: now.toISOString() };
}

export function registerCommissionRoutes(app: Express, _deps: V2Dependencies) {
  app.post('/api/commission/calculate', (req, res, next) => {
    try {
      const amountMajor = Number(req.body?.amountMajor ?? 0);
      const currency = String(req.body?.currency || 'PKR');
      const paymentMethod = String(req.body?.paymentMethod || 'jazzcash');
      if (!Number.isFinite(amountMajor) || amountMajor < 0 || amountMajor > 100000000 ||
          !['PKR', 'INR', 'USD', 'GBP', 'EUR', 'AED', 'SAR', 'CAD', 'AUD'].includes(currency) ||
          !['jazzcash', 'easypaisa', 'manual_bank', 'upi_india', 'payoneer', 'free_instant'].includes(paymentMethod)) {
        throw new ApiError(422, 'commission/invalid-input', 'Enter a supported amount, currency and manual payment method.');
      }
      res.json(commissionBreakdown(Math.round(amountMajor * 100), currency, paymentMethod));
    } catch (error) { next(error); }
  });
}
