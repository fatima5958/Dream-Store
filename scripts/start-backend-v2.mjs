#!/usr/bin/env node
// Isolated staging-only Backend V2 entrypoint.
// The production Dockerfile remains on scripts/start.mjs (V1).
if (process.env.DREAMSTORE_V2_STAGING !== '1') {
  console.error('Backend V2 cannot start outside explicitly enabled isolated staging.');
  process.exitCode = 1;
} else {
  try {
    await import('tsx/esm/api').then(({ register }) => register());
    const { createV2App } = await import('../server/v2/app.ts');
    const { createProductionV2Dependencies, createCloudStagingV2Dependencies } = await import('../server/v2/config/firebase.ts');
    const cloud = process.env.DREAMSTORE_V2_MODE === 'cloud-staging';
    const dependencies = cloud
      ? await createCloudStagingV2Dependencies()
      : createProductionV2Dependencies();
    const app = createV2App(dependencies);
    const port = Number(cloud ? (process.env.PORT || 8080) : (process.env.BACKEND_V2_PORT || 8091));
    // Cloud Run requires 0.0.0.0; emulator staging remains private loopback by default.
    const host = process.env.BACKEND_V2_BIND_HOST || (cloud ? '0.0.0.0' : '127.0.0.1');
    app.listen(port, host, () => console.log('DreamStore Backend V2 staging listening on ' + host + ':' + port));
  } catch {
    // Error details can contain provider metadata. Keep logs free of credentials and PII.
    console.error('DreamStore Backend V2 staging failed its secure startup checks.');
    process.exitCode = 1;
  }
}
