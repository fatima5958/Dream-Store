import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const app = read('src/App.tsx');
const wizard = read('src/components/screens/StoreSetupWizard.tsx');
const firebase = read('src/lib/firebase.ts');
const onboarding = read('src/components/RoleOnboardingModal.tsx');
const server = read('server.ts');

test('seller store is created only after an acknowledged server save', () => {
  const start = app.indexOf('  const persistStoreEverywhere = async');
  const end = app.indexOf('  const handleUpdateConfig =', start);
  assert.ok(start >= 0 && end > start);
  const content = app.slice(start, end);
  assert.match(content, /await fetch\('\/api\/stores\/create'/);
  assert.match(content, /if \(!saveResponse\.ok \|\| !saveResult\.ok\)/);
  assert.doesNotMatch(content, /INITIAL_PRODUCTS\.slice/);
  assert.doesNotMatch(content, /await setDoc\(/);
  assert.match(server, /await storeRef\.set\(storeDocument\)/);
  assert.match(server, /Store could not be saved securely/);
  const editor = app.slice(app.indexOf('  const handleUpdateConfig ='), app.indexOf('  const handleCompleteWizard ='));
  assert.match(editor, /if \(!existingSnap\.exists\(\)\) return/);
});

test('new sellers get real empty catalog and Free plan, never mock profile/payments', () => {
  assert.doesNotMatch(onboarding, /creator@dreamstore\.app/);
  assert.match(app, /plan: existingData\?\.plan \|\| 'Free'/);
  assert.doesNotMatch(app, /plan: existingData\?\.plan \|\| 'Pro'/);
  assert.match(app, /jazzCashEnabled: false/);
  assert.match(app, /easypaisaEnabled: false/);
  assert.match(app, /payoneerReceivingEmail: ''/);
  assert.match(server, /String\(user\.displayName \|\|/);
});

test('wizard has one clear creation flow and surfaces all backend errors', () => {
  assert.doesNotMatch(wizard, /onClick=\{\(\) => setWelcomeChoice\('manage'\)\}/);
  assert.match(wizard, /setValidationError\(err instanceof Error \? err\.message/);
  assert.match(wizard, /5\. Review Your Store/);
  assert.match(wizard, /Bio Link Preview/);
  assert.doesNotMatch(wizard, /Bio Link Claimed|Store Ready to Publish/);
});

test('Firebase email signup requests verification, without hardcoded identity', () => {
  assert.match(firebase, /sendEmailVerification\(cred\.user\)/);
  assert.match(onboarding, /An email address is required/);
  assert.doesNotMatch(server, /displayName: 'Fatima'/);
});

test('new production sessions never inherit a demo seller, personal branding or wallet', () => {
  assert.match(app, /const NEUTRAL_PUBLIC_STORE_CONFIG: StoreConfig/);
  const neutral = app.slice(app.indexOf('const NEUTRAL_PUBLIC_STORE_CONFIG'), app.indexOf('function buildFreshUserStoreConfig'));
  assert.match(neutral, /storeId: ''/);
  assert.match(neutral, /storeSlug: ''/);
  assert.match(neutral, /storeName: ''/);
  assert.match(neutral, /ownerEmail: ''/);
  const create = app.slice(app.indexOf('function buildFreshUserStoreConfig'), app.indexOf('export default function App'));
  assert.match(create, /\.\.\.NEUTRAL_PUBLIC_STORE_CONFIG/);
  assert.doesNotMatch(create, /fatima\.tech|ananya\.creates|displayStoreName/);
  assert.match(app, /import\.meta\.env\.DEV \? INITIAL_STORE_CONFIG\.storeId : ''/);
});

test('seller product deletion is durable and cannot silently resurrect on restart', () => {
  const serverDelete = server.slice(server.indexOf("app.post('/api/products/delete'"), server.indexOf("// 5. Server-Side Commission Calculator Endpoint"));
  assert.match(serverDelete, /await productRef\.update\(\{\s*published: false,\s*status: 'Draft',\s*deleted: true/);
  assert.match(serverDelete, /serverProducts\.delete/);
  assert.match(serverDelete, /snap\.get\('ownerId'\) !== user\.uid/);
  const clientDelete = app.slice(app.indexOf('  const handleDeleteProduct = async'), app.indexOf('  const handleSavePaymentSettings ='));
  assert.match(clientDelete, /await fetch\('\/api\/products\/delete'/);
  assert.match(clientDelete, /if \(!response\.ok\)/);
  assert.ok(clientDelete.indexOf('if (!response.ok)') < clientDelete.indexOf('setProducts((prev) => prev.filter'), 'UI updates after server acceptance');
  assert.doesNotMatch(clientDelete, /deleteDoc\(doc\(db, 'products'/);
});

test('seller catalog never silently assigns fake prices or files to a paid product', () => {
  const upsert = server.slice(server.indexOf('  const handleUpsertProduct = async'), server.indexOf("  app.post('/api/products/upsert'"));
  assert.match(upsert, /Set your own valid USD and PKR prices/);
  assert.match(upsert, /!Number\.isFinite\(givenUsd\)/);
  assert.match(upsert, /title\.length < 2/);
  assert.doesNotMatch(upsert, /Math\.max\(1, Number\(productPayload\.priceUsd\) \|\| 1\)/);
  assert.doesNotMatch(upsert, /fileSizeLabel: String\(productPayload\.fileSizeLabel \|\| '2\.4 MB'\)/);
});

test('verified user role is durably saved and reloaded from Firestore across Cloud Run restarts', () => {
  const readStart = server.indexOf('const handleGetUserProfile = async');
  const saveStart = server.indexOf('const handleSaveUserProfile = async');
  assert.ok(readStart > -1 && saveStart > readStart);
  const readProfile = server.slice(readStart, saveStart);
  const hydrateIdx = readProfile.indexOf("adminFirestoreDb.collection('users').doc(user.uid).get()");
  const fallbackIdx = readProfile.indexOf('const existingMem = serverUserProfiles.get(user.uid)');
  assert.ok(hydrateIdx >= 0 && fallbackIdx > hydrateIdx,
    'Firestore role must be checked before the server-local profile cache');
  const saveProfile = server.slice(saveStart, server.indexOf('function buildRolePermissions', saveStart));
  assert.match(saveProfile, /adminFirestoreDb\.runTransaction/);
  assert.match(saveProfile, /serverUserProfiles\.set\(user\.uid, savedProfile\)/);
  assert.ok(saveProfile.indexOf('await adminFirestoreDb.runTransaction') <
    saveProfile.indexOf('serverUserProfiles.set(user.uid, savedProfile)'));
  assert.match(saveProfile, /String\(user\.email \|\| ''\)/);
  assert.doesNotMatch(saveProfile, /body\.email \|\| user\.email/);
  assert.match(saveProfile, /Your account role could not be saved securely/);
});
