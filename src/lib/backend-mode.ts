// Build-time selection only; a query string/localStorage value cannot switch APIs.
export function selectFrontendBackend(env: {
  PROD?: boolean; DEV?: boolean;
  VITE_DREAMSTORE_BACKEND?: string; VITE_DREAMSTORE_V2_STAGING?: string;
}) {
  const backend = env.VITE_DREAMSTORE_BACKEND || 'v1';
  if (!['v1', 'v2'].includes(backend)) throw new Error('Unknown DreamStore frontend backend.');
  const emulator = env.VITE_DREAMSTORE_V2_STAGING === '1';
  if (emulator && (!env.DEV || env.PROD)) throw new Error('Emulator frontend cannot be built for production.');
  if (backend === 'v2' && !env.PROD) throw new Error('Production V2 frontend requires a production build.');
  return { productionV2: backend === 'v2', apiOnly: backend === 'v2' || emulator };
}
