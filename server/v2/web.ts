import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createV2App } from './app.ts';
import type { V2Dependencies } from './contracts.ts';

export function validateV2WebBuild(dist: string, identity: { projectId: string; firestoreDatabaseId: string }) {
  let manifest: Record<string, unknown>;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dist, 'dreamstore-build.json'), 'utf8')); }
  catch { throw new Error('A verified V2 frontend production build is required.'); }
  if (!manifest || manifest.backend !== 'v2' || manifest.projectId !== identity.projectId ||
      manifest.databaseId !== identity.firestoreDatabaseId || !fs.existsSync(path.join(dist, 'index.html'))) {
    throw new Error('V2 frontend build identity mismatch.');
  }
}

export function createV2WebApp(deps: V2Dependencies, dist: string, identity: { projectId: string; firestoreDatabaseId: string }) {
  validateV2WebBuild(dist, identity);
  const app = express();
  app.disable('x-powered-by');
  // API handlers (including their JSON 4xx/5xx) always precede the SPA fallback.
  app.use(createV2App(deps));
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y', dotfiles: 'deny' }));
  app.use(express.static(dist, { index: false, dotfiles: 'deny', maxAge: 0, setHeaders(res) { res.setHeader('Cache-Control', 'no-store'); } }));
  app.get('*', (req, res) => {
    // An unimplemented Firebase helper must never masquerade as the app.
    if (req.path.startsWith('/__/') || path.extname(req.path)) { res.sendStatus(404); return; }
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.resolve(dist, 'index.html'));
  });
  return app;
}
