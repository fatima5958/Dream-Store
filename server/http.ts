import express from 'express';

// Express 4 does not forward rejected async handlers to its error middleware.
export function asyncRoute(handler: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve().then(() => handler(req, res, next)).catch(next);
  };
}

export function installAuthHelperProxy(
  app: express.Express,
  config: { authDomain: string; apiKey: string; projectId: string },
  fetchUpstream: typeof fetch = fetch
): void {
  // Retire the old global relay: OAuth events must never be shared between users.
  app.all(['/__/auth/relay', '/__/auth/relay/*'], (_req, res) => {
    res.status(410).set('Cache-Control', 'no-store').json({ error: 'Use Firebase Authentication to sign in.' });
  });
  app.get('/__/firebase/init.json', (req, res) => {
    res.set('Cache-Control', 'no-store').json({
      apiKey: config.apiKey,
      authDomain: req.get('host'),
      projectId: config.projectId,
    });
  });
  // Firebase's documented same-origin proxy. Preserve helper bytes and POST
  // bodies; do not inject scripts, override SDK internals, or relay credentials.
  app.use('/__/auth', express.raw({ type: () => true, limit: '1mb' }), asyncRoute(async (req, res) => {
    if (!['GET', 'HEAD', 'POST'].includes(req.method)) {
      res.status(405).set('Allow', 'GET, HEAD, POST').end();
      return;
    }
    if (!/^[a-z0-9-]+\.firebaseapp\.com$/i.test(config.authDomain)) {
      res.status(503).send('Firebase Auth is not configured.');
      return;
    }
    const target = new URL(req.originalUrl, `https://${config.authDomain}`);
    if (target.hostname !== config.authDomain || !target.pathname.startsWith('/__/auth/')) {
      res.status(400).send('Invalid authentication helper path.');
      return;
    }
    try {
      const upstream = await fetchUpstream(target, {
        method: req.method,
        headers: {
          'Content-Type': req.get('content-type') || 'application/octet-stream',
          'Accept': req.get('accept') || '*/*',
        },
        ...(req.method === 'POST' ? { body: req.body } : {}),
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });
      res.status(upstream.status).set('Cache-Control', 'no-store');
      for (const header of ['content-type', 'location', 'content-security-policy']) {
        const value = upstream.headers.get(header);
        if (value) res.set(header, value);
      }
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      res.status(502).json({ error: 'Sign-in service is temporarily unavailable. Please retry.' });
    }
  }));
}

export const apiErrorHandler: express.ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err?.type === 'entity.too.large' ? 413 : err?.type === 'entity.parse.failed' ? 400 : 503;
  res.status(status).json({ error: status === 400 ? 'Invalid JSON request.' : status === 413
    ? 'Request is too large.' : 'Service temporarily unavailable. Please retry.' });
};
