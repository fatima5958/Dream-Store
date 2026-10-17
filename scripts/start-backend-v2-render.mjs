#!/usr/bin/env node
// Isolated Render V2 entrypoint. Production V1 startup is untouched.
if (process.env.DREAMSTORE_V2_STAGING !== '1' || process.env.DREAMSTORE_V2_MODE !== 'render-staging') {
  console.error('DreamStore Render V2 refuses unapproved startup.');
  process.exitCode = 1;
} else {
  try {
    await import('tsx/esm/api').then(({ register }) => register());
    const { createRenderStagingV2Dependencies } = await import('../server/v2/config/firebase.ts');
    const { createV2App } = await import('../server/v2/app.ts');
    const { createRenderTesterGate } = await import('../server/v2/modules/render-tester-gate.ts');
    const { default: express } = await import('express');
    const { deps, gate } = await createRenderStagingV2Dependencies();
    const app = express();
    app.disable('x-powered-by');
    app.use(createRenderTesterGate(gate));
    app.use(createV2App(deps));
    const port = Number(process.env.PORT || '10000');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
    app.listen(port, '0.0.0.0', () => console.log('DreamStore V2 guarded Render staging listening.'));
  } catch {
    console.error('DreamStore Render V2 failed secure startup checks.');
    process.exitCode = 1;
  }
}
