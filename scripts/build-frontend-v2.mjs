#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
  stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production', VITE_DREAMSTORE_BACKEND: 'v2' },
});
process.exitCode = result.status ?? 1;
