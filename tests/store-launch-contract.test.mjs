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
