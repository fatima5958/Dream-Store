import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const app = read('src/App.tsx');
const wizard = read('src/components/screens/StoreSetupWizard.tsx');
const firebase = read('src/lib/firebase.ts');
const authModal = read('src/components/CandylandAuthModal.tsx');
const onboarding = read('src/components/RoleOnboardingModal.tsx');
const server = read('server.ts');
const visualEditor = read('src/components/screens/VisualStoreEditor.tsx');

test('seller store is created only after an acknowledged server save', () => {
  const start = app.indexOf('  const persistStoreEverywhere = async');
  const end = app.indexOf('  const handleUpdateConfig =', start);
  assert.ok(start >= 0 && end > start);
  const content = app.slice(start, end);
  assert.match(content, /await fetch\('\/api\/stores\/create'/);
  assert.match(content, /if \(!saveResponse\.ok \|\| !saveResult\.ok\)/);
  assert.doesNotMatch(content, /INITIAL_PRODUCTS\.slice/);
  assert.doesNotMatch(content, /await setDoc\(/);
  assert.match(server, /await db\.runTransaction/);
  assert.match(server, /tx\.set\(storeRef, storeDocument\)/);
  assert.match(server, /Store could not be saved securely/);
  const editor = app.slice(app.indexOf('  const handleUpdateConfig ='), app.indexOf('  const handleCompleteWizard ='));
  assert.match(editor, /activeScreen === 'wizard'/);
  assert.match(editor, /await fetch\('\/api\/stores\/update'/);
  assert.doesNotMatch(editor, /await setDoc\(/);
});

test('cover uploads are bounded before JSON save and original-file errors are shown', () => {
  const owner = read('src/components/screens/StoreOwnerDashboard.tsx');
  const converter = read('src/lib/store-image.ts');
  assert.match(converter, /encoded\.length <= 220_000/);
  assert.match(converter, /toDataURL\('image\/jpeg'/);
  assert.match(wizard, /await prepareStoreImage\(file\)/);
  assert.match(owner, /await prepareStoreImage\(file\)/);
  assert.match(visualEditor, /await prepareStoreImage\(file\)/);
  assert.doesNotMatch(visualEditor, /reader\.readAsDataURL\(file\)/);
  assert.doesNotMatch(wizard, /reader\.readAsDataURL\(file\)/);
  assert.doesNotMatch(owner.slice(owner.indexOf('const handleImageUpload'), owner.indexOf('const handleDigitalFileUpload')), /reader\.readAsDataURL\(file\)/);
  assert.match(owner, /Upload failed: \$\{detail\}/);
  assert.doesNotMatch(owner, /Upload failed\. Your product has not been published\. Check Firebase Storage access/);
});

test('new sellers get real empty catalog and Free plan, never mock profile/payments', () => {
  assert.doesNotMatch(onboarding, /creator@dreamstore\.app/);
  assert.match(server, /existingById\?\.plan \|\| 'Free'/);
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

test('V2 signup remains enabled on a deployed public beta, with backend readiness checked', () => {
  assert.doesNotMatch(authModal, /renderStagingPreview|Preview Only — Sign-In Is Not Ready/);
  assert.match(authModal, /USE_V2_API\s*\? '\/api\/ready'/);
  assert.match(authModal, /if \(status\.status !== 'ready'\)/);
  assert.match(authModal, /await signUpWithEmailAccount\(trimmedEmail, password, trimmedName\)/);
  assert.match(firebase, /createUserWithEmailAndPassword\(auth, email, password\)/);
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

test('public endpoints do not expose financial metrics or count visits for unknown stores', () => {
  const health = server.slice(server.indexOf("app.get('/api/health'"), server.indexOf("// 0B. Firebase OAuth"));
  assert.doesNotMatch(health, /persistentLedgerRecords|immutableAuditLogs|signingSecretEntropyBits/);
  const visits = server.slice(server.indexOf("app.post('/api/stores/visit'"), server.indexOf("app.get('/api/stores/check-slug'"));
  assert.match(visits, /!matched \|\| matched\.status !== 'Active'/);
  assert.match(visits, /const targetStoreId = matched\.storeId/);
});

test('role onboarding refreshes Firebase ID token and securely recovers from a rejected session', () => {
  const start = app.indexOf('  const handleCompleteRoleOnboarding = async');
  const end = app.indexOf('  const handleNavigate =', start);
  assert.ok(start >= 0, 'onboarding handler exists');
  const roleHandler = app.slice(start, end < 0 ? start + 6500 : end);
  assert.match(roleHandler, /getAuthHeaders\(\{\}, \{ forceRefresh: true, requireAuth: true \}\)/);
  assert.match(roleHandler, /if \(res\.status === 401\)/);
  assert.match(roleHandler, /if \(hasFirebaseSdkSession\(\)\)/);
  assert.match(roleHandler, /Your account has not been signed out/);
  assert.match(roleHandler, /await requireNewSignIn\(\)/);
  assert.match(roleHandler, /setAuthModalMode\('signin'\)/);
  assert.match(roleHandler, /invalidateRejectedLegacyEmailSession\(\)/);
  assert.match(firebase, /auth\.currentUser\.getIdToken\(options\.forceRefresh === true\)/);
  assert.match(firebase, /if \(options\.requireAuth && !headers\.Authorization\)/);
  assert.match(firebase, /setServerEmailSession\(null\)/);
  assert.match(server, /code: 'auth\/session-invalid'/);
  assert.match(server, /const user = await extractVerifiedCaller\(req\)/);
});

test('seller onboarding preserves a valid Firebase login instead of restarting signup', () => {
  const start = app.indexOf('  const handleCompleteRoleOnboarding = async');
  const end = app.indexOf('  const persistStoreEverywhere = async', start);
  const flow = app.slice(start, end > start ? end : start + 9500);
  assert.match(flow, /if \(!currentUser\) \{\s*\/\/ Auth state can briefly lag/);
  assert.match(flow, /if \(hasFirebaseSdkSession\(\)\) \{\s*throw new Error\('Your account is signed in/);
  assert.match(flow, /getAuthHeaders\(\{\}, \{ forceRefresh: true, requireAuth: true \}\)/);
  assert.match(flow, /authHeaders = await getAuthHeaders\(\{\}, \{ requireAuth: true \}\)/);
  assert.match(flow, /setAuthVerificationIssue\(true\)/);
  assert.match(flow, /if \(res\.status === 403 && data\?\.code === 'auth\/email-not-verified' && hasFirebaseSdkSession\(\)\)/);
  assert.match(flow, /setPendingEmailVerification\(auth\.currentUser\?\.email/);
  assert.match(flow, /if \(res\.status === 401\) \{\s*if \(hasFirebaseSdkSession\(\)\)/);
  assert.match(flow, /Your account has not been signed out/);
});

test('auth restoration never promotes a locally cached role when backend identity is unverified', () => {
  const start = app.indexOf('// 2. Listen to Firebase & Email Authentication state');
  const end = app.indexOf('// 3.', start);
  assert.ok(start >= 0);
  const restoration = app.slice(start, end > start ? end : start + 21000);
  assert.doesNotMatch(restoration, /const cachedRaw = localStorage\.getItem/);
  assert.match(restoration, /getAuthHeaders\(\{\}, \{ requireAuth: true \}\)/);
  assert.match(restoration, /if \(profRes\.status === 401\)/);
  assert.match(restoration, /setAuthModalMode\('signin'\)/);
  assert.match(restoration, /DreamStore server cannot reach its secure Firebase database/);
  assert.match(restoration, /Could not verify your account/);
});

test('returning Firebase users never inherit seller or buyer privileges from public Firestore cache', () => {
  const start = app.indexOf('// 2. Listen to Firebase & Email Authentication state');
  const end = app.indexOf('// 3.', start);
  assert.ok(start >= 0, 'authentication restoration exists');
  const restoration = app.slice(start, end > start ? end : start + 21000);
  assert.doesNotMatch(restoration, /existingRole = 'seller'\s*;(?=[\s\S]*?storeSnap)/);
  assert.doesNotMatch(restoration, /const userSnap = await getDoc\(doc\(db, 'users', user\.uid\)\)/);
  assert.match(restoration, /if \(!existingRole\) \{\s*\/\/ Role and onboarding state must come from the verified backend/);
  assert.match(restoration, /if \(!existingRole\) \{\s*setUserProfile\(null\)/);
  assert.match(restoration, /let profRes = await fetch\('\/api\/users\/profile'/);
  assert.match(restoration, /profRes\.status === 401/);
});

test('admin interface never invents usage metrics or approves orders in bulk', () => {
  const admin = read('src/components/screens/SuperAdminDashboard.tsx');
  assert.doesNotMatch(admin, /visitsCount: 42 \+ idx \* 19|checkoutViewsCount: 9 \+ idx \* 4/);
  assert.doesNotMatch(admin, /productCount:.*\.length \|\| 2/);
  assert.doesNotMatch(admin, /handleInstantControlCommand\('approve_all_pending_orders'\)/);
  assert.doesNotMatch(admin, /triggerOrderUpdate\(ord\.id, 'Paid', 'Super Admin instant/);
  const statusHandler = admin.slice(admin.indexOf('const handleToggleStoreStatus'), admin.indexOf('const handleToggleStorePlan'));
  assert.ok(statusHandler.indexOf('if (!res.ok') < statusHandler.indexOf('setStores((prev)'));
  const planHandler = admin.slice(admin.indexOf('const handleToggleStorePlan'), admin.indexOf('const handleInstantControlCommand'));
  assert.ok(planHandler.indexOf('if (!res.ok') < planHandler.indexOf('setStores((prev)'));
  assert.match(admin, /Bulk payment approvals and mass store activation are disabled/);
});

test('atomic URL reservation and backend-only store edits prevent collisions', () => {
  const r = read('firestore.rules');
  const storeSection = r.slice(r.indexOf('match /stores/{storeId}'), r.indexOf('// 2A. Seller Payment Settings Collection'));
  assert.match(storeSection, /allow create, update, delete: if false/);
  assert.ok(storeSection.includes('match /store_slugs/{slug}'));
  assert.match(server, /tx\.create\(slugRef/);
  assert.match(server, /tx\.create\(newRef/);
  assert.match(server, /tx\.delete\(oldRef\)/);
  const wizard = read('src/components/screens/StoreSetupWizard.tsx');
  assert.doesNotMatch(wizard, /Fallback to Firestore check if network request fails/);
  assert.doesNotMatch(wizard, /Ignore read errors if offline/);
});

test('wizard checks existing creator URL with an authenticated identity', () => {
  const wizard = read('src/components/screens/StoreSetupWizard.tsx');
  assert.match(wizard, /getAuthHeaders\(\{\}, \{ requireAuth: true \}\)/);
  assert.match(wizard, /headers: authHeaders/);
});

test('moderated store data is recoverable across server restarts', () => {
  const helper = server.slice(server.indexOf('async function hydrateModeratedStoresFromAdminFirestore'),
    server.indexOf('void hydrateActiveStoresFromFirestore();'));
  assert.match(helper, /adminFirestoreDb\.collection\('stores'\)\.get\(\)/);
  assert.match(helper, /status: 'Pending'/);
  assert.match(server, /void hydrateModeratedStoresFromAdminFirestore\(\)/);
});

test('seller plan and suspension checks use fresh Firestore permissions', () => {
  const create = server.slice(server.indexOf('const handleCreateOrUpsertStore'), server.indexOf("app.post('/api/stores/create'"));
  assert.match(create, /!user\.emailVerified/);
  assert.match(create, /existingDoc\.get\('status'\) !== 'Active'/);
  const edit = server.slice(server.indexOf("app.post('/api/stores/update'"), server.indexOf('const resolveOwnedStoreForUser'));
  assert.match(edit, /store\.status !== 'Active'/);
  assert.match(edit, /fresh\.get\('status'\) !== 'Active'/);
  assert.match(edit, /fresh\.get\('plan'\) !== 'Pro'/);
  assert.doesNotMatch(edit, /sellerProEntitlements\.get\(store\.ownerId\)/);
});

test('seller payment settings never create a privileged cross-store legacy alias', () => {
  const privateCache = server.slice(server.indexOf('function cacheVerifiedSellerPaymentSettings'),
    server.indexOf('function initVerifiedSellerSettingsCache'));
  assert.doesNotMatch(privateCache, /store-fatima-tech|SUPER_ADMIN_UID/);
  const lookup = server.slice(server.indexOf('async function resolveVerifiedStoreRecord'),
    server.indexOf('async function hydrateModeratedStoresFromAdminFirestore'));
  assert.doesNotMatch(lookup, /fatimatech|cleanAlnum|store-fatima-tech/);
  assert.match(lookup, /s\.storeSlug\.toLowerCase\(\) === cleanLower/);
});

test('commission proof submits through a durable atomic Firestore transaction', () => {
  const segment = server.slice(server.indexOf('// Seller-submitted commission proof'),
    server.indexOf('// POST /api/commission/verify-payment'));
  assert.match(segment, /await db\.runTransaction/);
  assert.match(segment, /tx\.create\(reservationRef/);
  assert.match(segment, /tx\.create\(paymentRef/);
  assert.match(segment, /tx\.update\(invoiceRef/);
  assert.ok(segment.indexOf('await db.runTransaction') < segment.indexOf('commissionPayments.set'));
  assert.doesNotMatch(segment, /syncFirestoreDoc\(/);
});

test('admin commission approval requires actual payment proof and atomic persistence', () => {
  const segment = server.slice(server.indexOf('const handleVerifyCommissionPaymentOnServer'),
    server.indexOf("app.post('/api/commission/simulate-overdue'"));
  assert.match(segment, /fundsConfirmed !== true/);
  assert.match(segment, /payment\.status !== 'submitted'/);
  assert.match(segment, /await db\.runTransaction/);
  assert.match(segment, /tx\.update\(paymentRef/);
  assert.match(segment, /tx\.update\(invoiceRef/);
  assert.doesNotMatch(segment, /syncFirestoreDoc\(/);
  const adminUI = read('src/components/screens/SuperAdminDashboard.tsx');
  assert.match(adminUI, /paymentId: submitted\.paymentId/);
  assert.match(adminUI, /Verify Cleared Funds/);
  assert.match(adminUI, /window\.confirm\(/);
});

test('commission reconciliation cannot write invoices during GET requests', () => {
  const summary = server.slice(server.indexOf('function reconcileSellerCommissionState('),
    server.indexOf('async function hydrateCommissionRecords()'));
  assert.doesNotMatch(summary, /syncFirestoreDoc\(/);
  assert.doesNotMatch(summary, /commissionInvoices\.set\(/);
  assert.doesNotMatch(summary, /appendAuditEntry\(/);
  assert.match(summary, /map\(inv => \(\{ \.\.\.inv \}\)\)/);
});
test('commission invoice issuance is durable, idempotent and uses one currency per invoice', () => {
  const issue = server.slice(server.indexOf('async function issueDurableCommissionInvoicesForSeller'),
    server.indexOf('function computeServerCommissionMinor('));
  assert.match(issue, /commissionHydrationPromise/);
  assert.match(issue, /groups\.get\(entry\.currency\)/);
  assert.match(issue, /db\.runTransaction/);
  assert.match(issue, /tx\.create\(invoiceRef/);
  assert.match(issue, /tx\.update\(ref, \{ invoiceId \}\)/);
  assert.match(issue, /already\.exists/);
  const pay = server.slice(server.indexOf("app.post('/api/orders/verify-payment'"),
    server.indexOf('// 9B. Real-Time Express Order List'));
  assert.match(pay, /await issueDurableCommissionInvoicesForSeller\(entry\.sellerId\)/);
  assert.match(pay, /commissionBillingWarning/);
});

test('dispute status cannot self-approve platform fee or mutate invoices without durability', () => {
  const section = server.slice(server.indexOf('// A seller may dispute a fee'),
    server.indexOf('// 10C. SMART 5% COMMISSION MANAGEMENT SYSTEM ENDPOINTS'));
  assert.match(section, /newStatus === 'paid' \|\| newStatus === 'reversed'/);
  assert.match(section, /await db\.runTransaction/);
  assert.doesNotMatch(section, /syncFirestoreDoc\(/);
  assert.doesNotMatch(section, /applyOrderCommissionReversalToInvoice\(/);
});

test('refunded paid order updates invoice and adjustment in the same transaction', () => {
  const fn = server.slice(server.indexOf('async function commitFinancialOrderTransition'),
    server.indexOf('function signInvoiceRecord'));
  assert.match(fn, /entry\.paymentStatus === 'Refunded' && invoiceId/);
  assert.match(fn, /tx\.get\(invoiceRef\)/);
  assert.match(fn, /tx\.create\(adjustmentRef/);
  assert.match(fn, /tx\.update\(invoiceRef/);
  assert.match(fn, /tx\.set\(ledgerRef/);
  assert.match(fn, /tx\.set\(orderRef/);
  const refund = server.slice(server.indexOf("app.post('/api/orders/refund'"),
    server.indexOf('// 10B. Commission'));
  assert.doesNotMatch(refund, /applyOrderCommissionReversalToInvoice\(/);
});

test('subscriptions reflect fresh store entitlements and paid simulation is never public', () => {
  const get = server.slice(server.indexOf("app.get('/api/entitlements/:sellerId'"),
    server.indexOf("app.get('/api/subscriptions'"));
  assert.match(get, /fresh\.get\('plan'\) === 'Pro'/);
  assert.doesNotMatch(get, /sellerProEntitlements\.get/);
  const post = server.slice(server.indexOf("app.post('/api/subscriptions'"),
    server.indexOf('// No gateway adapter is installed'));
  assert.match(post, /req\.body\?\.status !== 'Waitlist'/);
  assert.match(post, /await db\.runTransaction/);
  assert.doesNotMatch(post, /sellerProEntitlements\.set/);
  const simulation = server.slice(server.indexOf("app.post('/api/commission/simulate-overdue'"),
    server.indexOf('// 10D. Server-Validated'));
  assert.match(simulation, /process\.env\.NODE_ENV === 'production'/);
  assert.match(simulation, /if \(!isSuper\)/);
});

test('release requires a separate staging smoke gate, not just green CI', () => {
  const script = read('scripts/release-preflight.mjs');
  const status = read('PRODUCTION_RELEASE_STATUS.md');
  assert.match(script, /\/api\/ready/);
  assert.match(script, /\/api\/orders\/verify-payment/);
  assert.match(script, /\/api\/commission\/verify-payment/);
  assert.match(script, /response\.status === expected/);
  assert.match(status, /NOT CERTIFIED FOR PAID PRODUCTION/);
  assert.match(status, /legacy ephemeral email accounts/i);
  assert.match(status, /DREAMSTORE_PAID_CHECKOUT_ENABLED=false/);
});

test('manual payment confirmation cannot be auto-checked and refunds require references', () => {
  const start = app.indexOf('const handleUpdateOrderStatus');
  const statusUpdate = app.slice(start, app.indexOf('const handleUpdateCommissionStatus', start));
  assert.match(statusUpdate, /const statementConfirmed = newStatus === 'Paid'/);
  assert.match(statusUpdate, /window\.confirm\(/);
  assert.match(statusUpdate, /refundReference = window\.prompt/);
  assert.doesNotMatch(statusUpdate, /statementConfirmed: true/);
  const refund = server.slice(server.indexOf("app.post('/api/orders/refund'"),
    server.indexOf('// A seller may dispute'));
  assert.match(refund, /refundConfirmed !== true/);
  assert.match(refund, /cleanRefundReference\.length < 3/);
});

test('financial documents are Admin SDK only; browser cannot forge orders or audits', () => {
  const rules = read('firestore.rules');
  const collections = [
    'orders/{orderId}', 'analytics/{analyticsId}', 'downloads/{downloadId}',
    'ledger_audit/{auditId}', 'subscriptions/{subscriptionId}',
    'commissionInvoices/{invoiceId}', 'commission_invoices/{invoiceId}',
    'commissionPayments/{paymentId}', 'commission_payments/{paymentId}',
    'commission_adjustments/{adjustmentId}',
  ];
  for (const segment of collections) {
    const pos = rules.indexOf('match /' + segment);
    assert.ok(pos >= 0, segment + ' exists');
    const block = rules.slice(pos, rules.indexOf('\n    }', pos));
    assert.match(block, /allow create, update, delete: if false/);
  }
  assert.doesNotMatch(server, /syncFirestoreDoc\(/);
  assert.doesNotMatch(server, /function applyOrderCommissionReversalToInvoice/);
  assert.match(server, /adminFirestoreDb\.collection\('ledger_audit'\)/);
});

test('staging preflight fails closed when paid checkout has not been separately approved', () => {
  const preflight = read('scripts/release-preflight.mjs');
  assert.match(preflight, /\/api\/payments\/gateway-status/);
  assert.match(preflight, /json\.paidCheckoutEnabled === false/);
  assert.match(preflight, /checkoutSafelyDisabled/);
  assert.match(preflight, /if \(failures > 0\) process\.exitCode = 1/);
});

test('first 100 creator claims are unique, atomic, and counted only after a new store saves', () => {
  const creation = server.slice(server.indexOf('const handleCreateOrUpsertStore'),
    server.indexOf("app.post('/api/stores/create'"));
  assert.match(server, /app\.get\('\/api\/launch\/creator-spots'/);
  assert.match(creation, /isFirstCreatorStore = !existingDoc\.exists && !isSuper/);
  assert.match(creation, /db\.collection\('creator_launch_campaigns'\)/);
  assert.match(creation, /db\.collection\('creator_launch_claims'\)\.doc\(ownerId\)/);
  assert.match(creation, /tx\.create\(claimRef/);
  assert.match(creation, /tx\.create\(campaignRef/);
  assert.match(creation, /tx\.update\(campaignRef/);
  assert.match(creation, /used >= CREATOR_LAUNCH_LIMIT/);
  assert.match(creation, /code === 'launch-full'/);
  assert.match(creation, /code === 'already-claimed'/);
  assert.ok(creation.indexOf('tx.set(storeRef, storeDocument)') <
    creation.indexOf('tx.create(claimRef'), 'claim writes are committed with store');
  const landing = read('src/components/screens/LandingPage.tsx');
  assert.match(landing, /creator-launch-counter/);
  assert.match(landing, /\/api\/launch\/creator-spots/);
  assert.match(landing, /creatorSpots.remaining/);
  assert.match(landing, /disabled=\{creatorOfferExhausted\}/);
  assert.match(landing, /5% fee applies only to verified paid sales/);
});

test('every landing free claim entry point reflects sold-out campaign safely', () => {
  const landing = read('src/components/screens/LandingPage.tsx');
  const pricing = read('src/components/ui/squishy-pricing.tsx');
  assert.match(landing, /creatorSpotsSoldOut=\{creatorOfferExhausted\}/);
  assert.match(landing, /creatorOfferExhausted \? 'Launch Spots Full'/);
  assert.match(pricing, /disabled=\{creatorSpotsSoldOut\}/);
  assert.match(pricing, /All 100 Launch Spots Claimed/);
});

test('account verification distinguishes backend HTML, permission errors, and network timeouts without escalating roles', () => {
  const auth = app.slice(app.indexOf('// 2. Listen to Firebase & Email Authentication state'),
    app.indexOf('// 3. Real-time Firestore listeners'));
  assert.match(auth, /AbortSignal\.timeout\(15000\)/);
  assert.match(auth, /headers\.get\('content-type'\)/);
  assert.match(auth, /DreamStore API is not connected on this address/);
  assert.match(auth, /profRes\.status === 503/);
  assert.match(auth, /setAuthVerificationIssue\(true\)/);
  assert.match(app, /data-testid="retry-account-verification"/);
  assert.match(app, /setAuthRestoreAttempt\(\(attempt\) => attempt \+ 1\)/);
  assert.doesNotMatch(auth, /await fetch\('\/api\/stores\/create'/);
  assert.match(auth, /setUserProfile\(null\)/);
});

test('first wizard step visibly explains verified founder spots and when they are claimed', () => {
  const wizard = read('src/components/screens/StoreSetupWizard.tsx');
  assert.match(wizard, /data-testid="wizard-founder-spots"/);
  assert.match(wizard, /\/api\/launch\/creator-spots/);
  assert.match(wizard, /remainingFounderSpots === null/);
  assert.match(wizard, /Your spot counts only after you finish setup and launch your store/);
});

test('embedded AI Studio preview does not retry a failed popup as a redirect', () => {
  const sdk = read('src/lib/firebase.ts');
  const modal = read('src/components/CandylandAuthModal.tsx');
  assert.match(sdk, /code: 'auth\/embedded-preview'/);
  assert.doesNotMatch(sdk, /if \(isPreviewIframeEnvironment\(\)\) \{\s*await signInWithPopup/);
  assert.match(modal, /auth-embedded-preview-guidance/);
  assert.match(modal, /Open DreamStore in New Tab/);
  assert.match(modal, /!insidePreview/);
  assert.match(modal, /DreamStore Backend Not Ready/);
});
test('OAuth readiness never self-authorizes the visitor hostname', () => {
  const diagnostics = server.slice(server.indexOf("app.get('/api/auth/oauth-diagnostics'"),
    server.indexOf("app.use('/api/auth/email'"));
  assert.doesNotMatch(diagnostics, /\.\.\.REQUIRED_AUTHORIZED_DOMAINS/);
  assert.doesNotMatch(diagnostics, /\.\.\.firebaseConsoleAuthorizedDomains,\s*\.\.\.REQUIRED_AUTHORIZED_DOMAINS/);
  assert.match(diagnostics, /identityToolkitReachable &&/);
  assert.match(diagnostics, /isHostnameAuthorized/);
});

test('email signup gates unverified Firebase users behind resend and verification instead of looping sign-in', () => {
  const restoration = app.slice(app.indexOf('// 2. Listen to Firebase & Email Authentication state'),
    app.indexOf('// 3. Real-time Firestore listeners'));
  assert.match(restoration, /hasFirebaseSdkSession\(\) && user\.emailVerified === false/);
  assert.match(restoration, /setPendingEmailVerification\(user\.email \|\| 'your inbox'\)/);
  assert.match(restoration, /if \(profRes\.status === 401 && hasFirebaseSdkSession\(\)\)/);
  assert.match(restoration, /getAuthHeaders\(\{\}, \{ forceRefresh: true, requireAuth: true \}\)/);
  assert.match(restoration, /DreamStore cannot verify this Firebase session/);
  assert.match(app, /data-testid="email-verification-required"/);
  assert.match(app, /data-testid="verify-email-check-btn"/);
  assert.match(app, /data-testid="verify-email-resend-btn"/);
  assert.match(app, /await firebaseUser\.reload\(\)/);
  assert.match(app, /await auth\.currentUser\.getIdToken\(true\)/);
  assert.match(firebase, /export async function resendCurrentUserVerificationEmail/);
  assert.match(firebase, /await sendEmailVerification\(user\)/);
  const modal = read('src/components/CandylandAuthModal.tsx');
  assert.match(modal, /Check your inbox for an email verification link/);
  assert.match(restoration, /setUserProfile\(null\)/);
});

test('Firebase Admin outages do not masquerade as invalid sessions or log private bearer tokens', () => {
  const verifier = server.slice(server.indexOf('class FirebaseAuthBackendUnavailableError'),
    server.indexOf('/**\n * Extracts and cryptographically verifies the caller'));
  assert.match(verifier, /verifyIdToken\(trimmed, true\)/);
  assert.match(verifier, /isInvalidFirebaseIdTokenError\(error\)/);
  assert.match(verifier, /safeFirebaseAdminFailureCode\(error\)/);
  assert.match(verifier, /throw new FirebaseAuthBackendUnavailableError\(\)/);
  assert.match(verifier, /code: safeFirebaseAdminFailureCode\(error\)/);
  assert.doesNotMatch(verifier, /console\.(error|log|warn)\([^\n]*\b(trimmed|rawToken)\b/);
  const auth = server.slice(server.indexOf('async function requireAuthenticatedUser('),
    server.indexOf('async function requireSuperAdminUser('));
  assert.match(auth, /res\.status\(503\)\.json\(\{/);
  assert.match(auth, /code: 'auth\/backend-unavailable'/);
  assert.match(auth, /code: 'auth\/session-invalid'/);
  const onboardingHandler = app.slice(app.indexOf('const handleCompleteRoleOnboarding = async'),
    app.indexOf('  const handleNavigate ='));
  assert.match(onboardingHandler, /if \(res\.status === 401\) \{\s*if \(hasFirebaseSdkSession\(\)\)/);
  assert.match(onboardingHandler, /await requireNewSignIn\(\)/);
  const getProfile = app.slice(app.indexOf("let profRes = await fetch('/api/users/profile'"),
    app.indexOf('const profData = await profRes.json()'));
  assert.match(getProfile, /errorBody\?\.code === 'auth\/backend-unavailable'/);
});

test('auth restoration ignores stale async runs before applying roles, modal and store state', () => {
  const start = app.indexOf('  // 2. Listen to Firebase & Email Authentication state');
  const end = app.indexOf('  }, [authRestoreAttempt]);', start);
  assert.ok(start >= 0 && end > start, 'auth effect exists');
  const effect = app.slice(start, end);
  assert.match(effect, /let authRunSeq = 0/);
  assert.match(effect, /const runId = \+\+authRunSeq/);
  assert.match(effect, /const isStale = \(\) => runId !== authRunSeq/);
  assert.ok((effect.match(/if \(isStale\(\)\) return;/g) || []).length >= 12);
  const adminDone = effect.indexOf('setIsSuperAdminVerified(verifiedSuperAdmin)');
  assert.ok(adminDone > 0 && effect.lastIndexOf('if (isStale()) return;', adminDone) > effect.indexOf('const adminRes'));
  assert.match(effect, /if \(isStale\(\)\) return;\s*invalidateRejectedLegacyEmailSession\(\)/);
  assert.match(effect, /authRunSeq \+= 1;[\s\S]*unsub\(\)/);
  assert.doesNotMatch(effect, /localStorage\.getItem\(`dreamstore_user_profile_/);
});

test('readiness failures are logged safely without changing the public API response', () => {
  const ready = server.slice(server.indexOf('let lastReadinessWarningAt'),
    server.indexOf('// 0B. Firebase OAuth'));
  assert.match(ready, /\[DreamStore Ready\] not ready:/);
  assert.match(ready, /adminFirestoreInitialized: Boolean\(adminFirestoreDb\)/);
  assert.match(ready, /safeFirebaseAdminFailureCode\(error\)/);
  assert.match(ready, /dependency check timed out/);
  assert.match(ready, /now - lastReadinessWarningAt < 60000/);
  assert.doesNotMatch(ready, /console\.\w+\([^)]*(error\.message|process\.env\.[A-Z_]*SECRET|rawToken|Authorization)/);
  assert.match(ready, /json\(\{ status: ready \? 'ready' : 'not_ready' \}\)/);
});

test('OAuth diagnostics flag redirect URI names as unverified source-code values', () => {
  assert.match(server, /registeredRedirectUrisSource: 'source-code-list-unverified'/);
});

test('rejected legacy sessions open Sign In before sign-out invalidates their auth run', () => {
  const effect = app.slice(app.indexOf('// 2. Listen to Firebase & Email Authentication state'),
    app.indexOf('  }, [authRestoreAttempt]);'));
  const branch = effect.slice(effect.indexOf('if (profRes.status === 401)'),
    effect.indexOf('if (!profRes.headers.get', effect.indexOf('if (profRes.status === 401)')));
  assert.ok(branch.indexOf('invalidateRejectedLegacyEmailSession()') >= 0);
  assert.ok(branch.indexOf("setAuthModalOpen(true)") >= 0);
  assert.ok(branch.indexOf("await signOutUser().catch") > branch.indexOf("setAuthModalOpen(true)"),
    'sign-in recovery must be made visible before the legacy sign-out event invalidates the previous auth run');
  assert.match(branch, /if \(isStale\(\)\) return;[\s\S]*invalidateRejectedLegacyEmailSession\(\)/);
});

test('guest Gemini assistant enforces message-count and character caps before external model calls', () => {
  const route = server.slice(server.indexOf("app.post('/api/gemini/chat'"));
  assert.match(route, /const MAX_CHAT_MESSAGES = 30/);
  assert.match(route, /const MAX_CHAT_MESSAGE_CHARS = 4000/);
  assert.match(route, /res\.status\(413\)/);
  assert.ok(route.indexOf('messages.length > MAX_CHAT_MESSAGES') < route.indexOf('const apiKey = process.env.GEMINI_API_KEY'));
  assert.ok(route.indexOf('MAX_CHAT_MESSAGE_CHARS') < route.indexOf('ai.models.generateContent'));
});
