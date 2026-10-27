#!/usr/bin/env node
// Fail closed: the existing production Firebase app must never be shipped as a staging frontend.
import fs from 'node:fs';
const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
const expectedProject = 'tidal-axis-511800-n1';
const expectedDatabase = 'dreamstore-v2-staging';
const manifest = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : null;
if (config.projectId !== expectedProject || config.firestoreDatabaseId !== expectedDatabase ||
    (manifest && (manifest.backend !== 'v2' || manifest.projectId !== expectedProject || manifest.databaseId !== expectedDatabase))) {
  console.error('V2 staging frontend identity mismatch: refusing deployment.');
  process.exit(1);
}
console.log('V2 staging frontend identity verified.');
