/** Separate tester-only gate in front of every Render V2 HTTP route.
 * Cookie is intentionally independent of Firebase Authorization Bearer tokens.
 */
import express, { type RequestHandler } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE = '__Host-dreamstore-v2-stage';
const TWO_HOURS = 2 * 60 * 60 * 1000;
export function createRenderTesterGate(config: { origin: string; testerPassword: string; signingSecret: string }): RequestHandler {
  let failures = 0;
  let windowStart = Date.now();
  const digest = (value: string) => createHmac('sha256', config.signingSecret).update(value).digest('base64url');
  const equals = (a: string, b: string) => {
    const x = Buffer.from(a); const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  };
  const validSession = (header: string) => {
    const encoded = header.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';
    const pieces = encoded.split('.');
    if (pieces.length !== 3 || !/^\d{13}$/.test(pieces[0]) || !/^[a-f0-9]{32}$/.test(pieces[1])) return false;
    const expiry = Number(pieces[0]);
    return Number.isSafeInteger(expiry) && expiry > Date.now() && expiry <= Date.now() + TWO_HOURS &&
      equals(pieces[2], digest(pieces[0] + '.' + pieces[1]));
  };
  const loginBody = express.urlencoded({ extended: false, limit: '1kb', parameterLimit: 2 });
  return (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Content-Security-Policy', "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    const origin = req.headers.origin;
    if (origin && origin !== config.origin) { res.status(403).json({ code: 'staging/origin-denied' }); return; }
    const host = new URL(config.origin).host;
    if (req.headers.host !== host) { res.status(403).json({ code: 'staging/host-denied' }); return; }
    if (req.path === '/__staging/login' && req.method === 'GET') {
      res.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>DreamStore V2 staging</h1><form action="/__staging/login" method="post"><label>Tester password <input type="password" name="password" required autocomplete="off"></label><button type="submit">Enter</button></form></body></html>');
      return;
    }
    if (req.path === '/__staging/login' && req.method === 'POST') {
      if (origin !== config.origin) { res.status(403).end(); return; }
      loginBody(req, res, error => {
        if (error) { res.status(400).end(); return; }
        if (Date.now() - windowStart > 10 * 60_000) { windowStart = Date.now(); failures = 0; }
        if (failures >= 8) { res.set('Retry-After', '600').status(429).end(); return; }
        if (typeof req.body?.password !== 'string' || !equals(req.body.password, config.testerPassword)) {
          failures++; res.status(401).json({ code: 'staging/access-denied' }); return;
        }
        failures = 0;
        const base = String(Date.now() + TWO_HOURS) + '.' + randomBytes(16).toString('hex');
        res.set('Set-Cookie', COOKIE + '=' + base + '.' + digest(base) +
          '; Path=/; Max-Age=7200; HttpOnly; Secure; SameSite=Strict');
        res.redirect(303, '/');
      });
      return;
    }
    if (!validSession(req.headers.cookie || '')) { res.status(401).json({ code: 'staging/access-required' }); return; }
    if (req.path === '/__staging/logout' && req.method === 'POST') {
      if (origin !== config.origin) { res.status(403).end(); return; }
      res.set('Set-Cookie', COOKIE + '=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict');
      res.status(204).end(); return;
    }
    // The login page is locked down, but authenticated testers need the SPA assets
    // and Firebase network requests. This remains behind the signed tester cookie.
    res.set('Content-Security-Policy',
      "default-src 'self' https: data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
    next();
  };
}
