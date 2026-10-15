#!/usr/bin/env node
// Isolated staging-only Backend V2 entrypoint.
// The production Dockerfile remains on scripts/start.mjs (V1).
if (process.env.DREAMSTORE_V2_STAGING !== '1') {
  console.error('Backend V2 cannot start outside explicitly enabled isolated staging.');
  process.exitCode = 1;
} else {
  await import('tsx/esm/api').then(({ register }) => register());
  const { createV2App } = await import('../server/v2/app.ts');
  const { createProductionV2Dependencies } = await import('../server/v2/config/firebase.ts');
  const app = createV2App(createProductionV2Dependencies());
  const port = Number(process.env.BACKEND_V2_PORT || 8091);
  // Private loopback by default; deliberate network exposure requires explicit host.
  const host = process.env.BACKEND_V2_BIND_HOST || '127.0.0.1';
  app.listen(port, host, () => console.log('DreamStore Backend V2 staging listening on ' + host + ':' + port));
}
