#!/usr/bin/env node
// Isolated Render V2 entrypoint. Production V1 startup is untouched.
// Report only trusted validation categories. Never log credentials or raw provider errors.
if (process.env.DREAMSTORE_V2_STAGING !== '1' || process.env.DREAMSTORE_V2_MODE !== 'render-staging') {
  console.error('DreamStore Render V2 refuses unapproved startup.');
  process.exitCode = 1;
} else {
  let startupPhase = 'module-loading';
  try {
    await import('tsx/esm/api').then(({ register }) => register());
    const { createRenderStagingV2Dependencies } = await import('../server/v2/config/firebase.ts');
    const { createV2WebApp } = await import('../server/v2/web.ts');
    const { default: path } = await import('node:path');
    const { default: fs } = await import('node:fs');
    const { createRenderTesterGate } = await import('../server/v2/modules/render-tester-gate.ts');
    const { default: express } = await import('express');
    startupPhase = 'staging-dependency-validation';
    const { deps, gate } = await createRenderStagingV2Dependencies();
    startupPhase = 'http-setup';
    const app = express();
    app.disable('x-powered-by');
    app.use(createRenderTesterGate(gate));
    // Preview bundles the existing frontend until staging's Firebase web-app
    // credentials are configured. Backend data and writes remain staging-only.
    const clientIdentity = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
    app.use(createV2WebApp(deps, path.resolve('dist'), clientIdentity));
    const port = Number(process.env.PORT || '10000');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
    app.listen(port, '0.0.0.0', () => console.log('DreamStore V2 guarded Render staging listening.'));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    // The following are fixed strings from our own configuration guards, not vendor error bodies.
    const safeConfigErrors = new Set([
      'Render staging Firebase secret file is invalid.',
      'Render V2 staging refuses an unapproved Firebase service account key.',
      'Render staging dependencies unavailable.',
      'Render V2 staging requires the exact approved runtime and service origin.',
      'Render V2 staging Firebase project identity does not match the staging allowlists.',
      'Render V2 staging requires private Supabase storage with payments and AI disabled.',
      'Render staging Supabase project/bucket identity mismatch.',
      'Render staging requires distinct strong tester and signing secrets.',
      'Invalid staging admin UID.',
    ]);
    const runtimeKey = /^Render V2 staging runtime mismatch: ([A-Z0-9_]+)$/.exec(message);
    const missingKey = /^Render staging missing required configuration: ([A-Z0-9_]+)$/.exec(message);
    const reason = safeConfigErrors.has(message) ? message
      : runtimeKey ? 'Runtime identity mismatch: ' + runtimeKey[1]
      : missingKey ? 'Missing required config key: ' + missingKey[1]
      : error && typeof error === 'object' && error.code === 'ENOENT' ? 'Required startup file not found.'
      : 'Unclassified failure; see dependency readiness category.';
    console.error('DreamStore Render V2 failed secure startup checks. Phase: ' + startupPhase + '. Reason: ' + reason);
    process.exitCode = 1;
  }
}
