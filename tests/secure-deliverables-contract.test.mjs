import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const seller = read('src/components/screens/StoreOwnerDashboard.tsx');
const app = read('src/App.tsx');
const firebase = read('src/lib/firebase.ts');
const server = read('server.ts');
const rules = read('storage.rules');
const types = read('src/types/dreamstore.ts');

test('5 MiB file size limit is enforced before upload and in Storage rules', () => {
  assert.match(seller, /MAX_FILE_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024/);
  assert.match(seller, /file\.size\s*>\s*MAX_FILE_BYTES/);
  assert.match(rules, /request\.resource\.size\s*<=\s*5\s*\*\s*1024\s*\*\s*1024/);
  assert.doesNotMatch(seller, /450 KB maximum|max 450 KB/i);
});

test('upload uses owner/product-scoped private Firebase Storage without sample substitution', () => {
  assert.match(firebase, /export const storage = getStorage\(app\)/);
  assert.match(seller, /uploadBytesResumable\(/);
  assert.match(seller, /deliverables\/\$\{sdkUid\}\/\$\{productId\}\//);
  assert.match(server, /app.post\('\/api\/uploads\/product'/);
  assert.match(server, /resolveOwnedStoreForUser\(user.uid\)/);
  assert.match(seller, /setProdFileDataUrl\(`storage:\/\//);
  assert.doesNotMatch(seller, /createSampleGuideDataUrl/);
  assert.match(rules, /request\.auth\.uid == ownerId \|\| isSuperAdmin\(\)/);
  assert.match(rules, /allow list: if false/);
});

test('original file storage references are persisted and only the server can deliver', () => {
  assert.match(app, /fileDataUrl\.startsWith\('storage:\/\/'\)/);
  assert.doesNotMatch(app, /createSampleGuideDataUrl/);
  assert.match(server, /getAdminStorage\(\)\.bucket\(FIREBASE_STORAGE_BUCKET\)\.file\(objectPath\)/);
  assert.match(server, /objectPath\.startsWith\(allowedPrefix\)/);
  assert.match(server, /contentSize\s*>\s*5\s*\*\s*1024\s*\*\s*1024/);
  assert.match(server, /Verified order not found\. Download denied/);
  assert.match(server, /No sample file was substituted or download counted/);
});

test('paid product checkout must use a server-authoritative catalog', () => {
  assert.match(server, /Product not found in the verified catalog/);
  assert.doesNotMatch(server, /Custom user-created product validation/);
  assert.match(server, /await financialDb\.runTransaction/);
  assert.match(server, /commitFinancialOrderTransition/);
});

test('download count is committed atomically and never accepted from browser state', () => {
  assert.match(server, /committedDownloadCount = await adminFirestoreDb!\.runTransaction/);
  assert.match(server, /tx\.update\(ledgerRef, \{ downloadCount: next, updatedAtIso: now\.toISOString\(\) \}\)/);
  assert.match(server, /count >= max/);
  assert.match(server, /saved\.paymentStatus !== 'Paid'/);
  assert.match(server, /if \(\!\(await ensureFinancialDatabaseReady\(res\)\)\) return/);
});

test('a seller must have a real stored file before publishing a product', () => {
  assert.match(server, /getAdminStorage\(\)\.bucket\(FIREBASE_STORAGE_BUCKET\)\.file\(objectPath\)\.getMetadata\(\)/);
  assert.match(server, /fileReference !== storedReference/);
  assert.match(server, /Secure file reference is invalid/);
  assert.match(server, /Could not save product to Firebase/);
  assert.match(app, /published: false,\s*status: 'Draft'/);
  assert.match(app, /The server could not publish this product/);
});

test('public users see no fabricated products, cart, stores or hardcoded admin contact', () => {
  assert.match(app, /import\.meta\.env\.DEV \? INITIAL_PRODUCTS : \[\]/);
  assert.match(app, /useState<CartItem\[\]>\(\[\]\)/);
  assert.match(app, /import\.meta\.env\.DEV \? INITIAL_PLATFORM_STORES : \[\]/);
  assert.match(app, /import\.meta\.env\.DEV &&/);
  assert.match(types, /INITIAL_PLATFORM_STORES: PlatformStore\[\] = \[\]/);
  assert.match(server, /const SUPER_ADMIN_EMAIL = ''/);
  assert.match(server, /visitsCount: 0/);
  assert.match(server, /checkoutViewsCount: 0/);
  assert.doesNotMatch(server, /mateenfatima5958@gmail\.com/);
  assert.doesNotMatch(server, /03359379024|0342126300/);
});

test('production refuses financial operations without a durable download signing secret', () => {
  assert.match(server, /HAS_DURABLE_PRODUCTION_SIGNING_SECRET/);
  assert.match(server, /process\.env\.NODE_ENV === 'production' && !HAS_DURABLE_PRODUCTION_SIGNING_SECRET/);
  assert.match(server, /configure a durable SERVER_SIGNING_SECRET before enabling orders/);
  assert.match(server, /async function ensureFinancialDatabaseReady\(/);
});
