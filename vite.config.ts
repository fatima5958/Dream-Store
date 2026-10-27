import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import {defineConfig, loadEnv} from 'vite';
import firebaseConfig from './firebase-applet-config.json';
import { selectFrontendBackend } from './src/lib/backend-mode';

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const backend = selectFrontendBackend({ ...env, PROD: command === 'build', DEV: command === 'serve' });
  return {
    plugins: [react(), tailwindcss(), {
      name: 'dreamstore-backend-build-identity',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'dreamstore-build.json', source: JSON.stringify({
          backend: backend.productionV2 ? 'v2' : 'v1', projectId: firebaseConfig.projectId,
          databaseId: firebaseConfig.firestoreDatabaseId,
        }) });
      },
    }],
    resolve: {
      alias: {
        '@': path.dirname(fileURLToPath(import.meta.url)),
      },
    },
    server: {
      ...(env.VITE_DREAMSTORE_V2_STAGING === '1' ? { proxy: { '/api': 'http://127.0.0.1:8091' } } : {}),
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
