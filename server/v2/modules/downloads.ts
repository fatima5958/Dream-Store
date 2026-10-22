import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Express } from 'express';
import type { V2Dependencies } from '../contracts.ts';
import { ApiError } from '../errors.ts';
import { authenticatedPrincipal } from './auth.ts';
import { canDownload } from './download-policy.ts';

function decodeToken(token: unknown, secret: string) {
  if (typeof token !== 'string' || token.length > 4096 || secret.length < 32) return null;
  const [body, signature, ...extra] = token.split('.');
  if (!body || !signature || extra.length) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || Date.now() >= payload.exp || !payload.orderNumber || !payload.productId || !payload.buyerId || !payload.tokenId) return null;
    return payload;
  } catch { return null; }
}
export function registerDownloadRoutes(app: Express, deps: V2Dependencies) {
  app.post('/api/downloads/token', (req, res, next) => (async () => {
    const principal = await authenticatedPrincipal(req, deps);
    const order = await deps.finance!.order(String(req.body?.orderNumber || ''));
    if (!order || order.buyerId !== principal.uid || !canDownload(order)) throw new ApiError(403, 'downloads/not-authorized', 'A valid paid order belonging to this Buyer is required.');
    res.json({ ok: true, downloadToken: (await import('./checkout.ts')).createDownloadToken(order, deps.downloadTokenSecret || ''), expiresAtMs: order.expiresAtMs });
  })().catch(next));
  app.post('/api/delivery/verify-download', (req, res, next) => (async () => {
    const principal = await authenticatedPrincipal(req, deps);
    if (!deps.allowWrites) throw new ApiError(503, 'backend/staging-readonly', 'Download consumption is disabled outside isolated staging.');
    const payload = decodeToken(req.body?.downloadToken, deps.downloadTokenSecret || '');
    if (!payload || payload.buyerId !== principal.uid || payload.orderNumber !== String(req.body?.orderNumber || '') || payload.productId !== String(req.body?.productId || '') || (req.body?.buyerId && req.body.buyerId !== principal.uid)) throw new ApiError(403, 'downloads/token-invalid', 'Invalid, expired or out-of-scope download token.');
    const result = await deps.finance!.consumeDownload(payload.orderNumber, principal.uid, payload.productId, payload.tokenId);
    const mime = String(result.deliverable.fileMimeType || result.deliverable.contentType || 'application/octet-stream').toLowerCase();
    const fileName = String(result.deliverable.fileName || 'Digital-Download').replace(/[\r\n"\\]/g, '_').slice(0, 255);
    res.json({ allowed: true, fileName, fileDataUrl: result.fileDataUrl, downloadCount: result.order.downloadCount,
      maxDownloads: result.order.maxDownloads, expiresAtMs: result.order.expiresAtMs, contentType: mime,
      nextDownloadToken: (await import('./checkout.ts')).createDownloadToken(result.order, deps.downloadTokenSecret || '') });
  })().catch(next));
}
