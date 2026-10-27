#!/usr/bin/env node
// Opt-in API entrypoint only. The existing V1 and staging commands stay intact.
if (process.env.NODE_ENV !== 'production' || process.env.DREAMSTORE_V2_MODE !== 'production' ||
    process.env.DREAMSTORE_V2_PRODUCTION_ENABLED !== 'true' || process.env.DREAMSTORE_V2_STAGING === '1') {
  console.error('DreamStore V2 production requires explicit production configuration.');
  process.exitCode = 1;
} else {
  try {
    await import('tsx/esm/api').then(({ register }) => register());
    const { createLiveProductionV2Dependencies } = await import('../server/v2/config/firebase.ts');
    const { createV2App } = await import('../server/v2/app.ts');
    const port = Number(process.env.PORT || 8080);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
    const dependencies = await createLiveProductionV2Dependencies();
    const server = createV2App(dependencies).listen(port, '0.0.0.0', () => {
      console.log('DreamStore V2 production API listening.');
    });
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 25000).unref();
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  } catch {
    // Provider errors can include private credential/project metadata.
    console.error('DreamStore V2 production startup validation failed.');
    process.exitCode = 1;
  }
}
