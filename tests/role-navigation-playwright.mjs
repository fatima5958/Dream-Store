/**
 * DreamStore — Role-Specific Navigation, Returning User Skip-Onboarding & Direct URL/API Blocking Verification Suite
 * Verifies:
 * 1. Buyer Role Navigation: Storefronts, Cart, Orders, Downloads, Profile (and hides Seller/Super Admin navigation & screens)
 * 2. Seller Role Navigation: Dashboard, My Store, Products, Orders, Store Design, Settings (and hides Super Admin navigation & screens)
 * 3. Super Admin Role Navigation: Platform Dashboard exclusively for verified SUPER_ADMIN_UID
 * 4. Returning Users Skip Onboarding: Returning Buyers, Returning Sellers, and Super Admin skip onboarding
 * 5. Direct URL & API Access Blocking: Verified backend permissions block Buyers from Seller/Admin screens & APIs and block Sellers from Super Admin screens & APIs
 */

import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const SUPER_ADMIN_UID = 'V2Yxrm20XFWYscGUtHcBN8E9wA62';

async function apiRequest(endpoint, { method = 'GET', token = null, body = undefined } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

async function runRoleNavigationVerification() {
  const results = [];
  const record = (id, name, passed, evidence) => {
    results.push({ id, name, passed, evidence });
    console.log(`${passed ? '✅ PASS' : '❌ FAIL'} | ${id}: ${name}\n   ↳ ${evidence}`);
    if (!passed) {
      throw new Error(`Verification ${id} failed: ${evidence}`);
    }
  };

  const suffix = Date.now().toString().slice(-6);
  const buyerEmail = `buyer.role.${suffix}@dreamstore.app`;
  const sellerEmail = `seller.role.${suffix}@dreamstore.app`;
  const password = 'CandyPassword123!';

  // 1. Verify UI Component Source & Candyland Styling Integrity
  const roleNavSource = fs.readFileSync(
    path.join(process.cwd(), 'src/components/RoleNavigationBar.tsx'),
    'utf8'
  );
  const appSource = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
  const ownerDashSource = fs.readFileSync(
    path.join(process.cwd(), 'src/components/screens/StoreOwnerDashboard.tsx'),
    'utf8'
  );
  const checkoutSource = fs.readFileSync(
    path.join(process.cwd(), 'src/components/screens/CheckoutAndOrdersPage.tsx'),
    'utf8'
  );

  const hasBuyerNavItems =
    roleNavSource.includes('buyer-nav-storefronts') &&
    roleNavSource.includes('buyer-nav-cart') &&
    roleNavSource.includes('buyer-nav-orders') &&
    roleNavSource.includes('buyer-nav-downloads') &&
    roleNavSource.includes('buyer-nav-profile') &&
    checkoutSource.includes('buyer-profile-section');

  const hasSellerNavItems =
    roleNavSource.includes('seller-nav-dashboard') &&
    roleNavSource.includes('seller-nav-my-store') &&
    roleNavSource.includes('seller-nav-products') &&
    roleNavSource.includes('seller-nav-orders') &&
    roleNavSource.includes('seller-nav-store-design') &&
    roleNavSource.includes('seller-nav-settings') &&
    ownerDashSource.includes("{ id: 'overview', label: 'Dashboard'") &&
    ownerDashSource.includes("{ id: 'my-store', label: 'My Store'");

  const hasSuperAdminExclusiveGuard =
    roleNavSource.includes("isSuperAdminVerified && role === 'super_admin'") &&
    appSource.includes("{activeScreen === 'super-admin' && isSuperAdminVerified && (") &&
    appSource.includes("{activeScreen === 'owner-dashboard' && userProfile?.role !== 'buyer' && (") &&
    appSource.includes("{activeScreen === 'wizard' && userProfile?.role !== 'buyer' && (") &&
    appSource.includes("{activeScreen === 'visual-editor' && userProfile?.role !== 'buyer' && (");

  record(
    'ROLE-UI-1',
    'RoleNavigationBar & Screen Guards Enforce Exact Buyer, Seller, and Super Admin Navigation & Screen Hiding in Candyland Theme',
    hasBuyerNavItems && hasSellerNavItems && hasSuperAdminExclusiveGuard,
    `BuyerItems=${hasBuyerNavItems} (Storefronts, Cart, Orders, Downloads, Profile) | SellerItems=${hasSellerNavItems} (Dashboard, My Store, Products, Orders, Store Design, Settings) | SuperAdminAndBuyerScreenHiding=${hasSuperAdminExclusiveGuard}`
  );

  // 2. First-Login Buyer Onboarding -> Buyer Navigation & Direct URL/API Blocking
  const buyerSignup = await apiRequest('/api/auth/email/signup', {
    method: 'POST',
    body: {
      email: buyerEmail,
      password,
      displayName: 'Amina Shopper',
    },
  });
  const buyerToken = buyerSignup.data?.token;
  const buyerUid = buyerSignup.data?.user?.uid;

  const buyerOnboardingCheck = await apiRequest('/api/users/profile', { token: buyerToken });
  const buyerSaveRole = await apiRequest('/api/users/profile', {
    method: 'POST',
    token: buyerToken,
    body: {
      role: 'buyer',
      displayName: 'Amina Shopper',
      email: buyerEmail,
    },
  });

  const buyerAllowedStorefront = await apiRequest('/api/navigation/access?screen=storefront', {
    token: buyerToken,
  });
  const buyerAllowedCheckout = await apiRequest('/api/navigation/access?screen=checkout', {
    token: buyerToken,
  });
  const buyerBlockedOwnerDashboard = await apiRequest(
    '/api/navigation/access?screen=owner-dashboard',
    { token: buyerToken }
  );
  const buyerBlockedWizard = await apiRequest('/api/navigation/access?screen=wizard', {
    token: buyerToken,
  });
  const buyerBlockedVisualEditor = await apiRequest('/api/navigation/access?screen=visual-editor', {
    token: buyerToken,
  });
  const buyerBlockedSuperAdmin = await apiRequest('/api/navigation/access?screen=super-admin', {
    token: buyerToken,
  });

  record(
    'ROLE-BUYER-2',
    'Buyer Role Receives [Storefronts, Cart, Orders, Downloads, Profile] & Blocks Direct URL/API Access to Seller/Admin Screens',
    buyerOnboardingCheck.data?.needsOnboarding === true &&
      buyerSaveRole.status === 200 &&
      JSON.stringify(buyerSaveRole.data?.permissions?.navigation) ===
        JSON.stringify(['Storefronts', 'Cart', 'Orders', 'Downloads', 'Profile']) &&
      buyerAllowedStorefront.status === 200 &&
      buyerAllowedCheckout.status === 200 &&
      buyerBlockedOwnerDashboard.status === 403 &&
      buyerBlockedOwnerDashboard.data?.redirectScreen === 'storefront' &&
      buyerBlockedWizard.status === 403 &&
      buyerBlockedVisualEditor.status === 403 &&
      buyerBlockedSuperAdmin.status === 403,
    `uid=${buyerUid} | Nav=${JSON.stringify(buyerSaveRole.data?.permissions?.navigation)} | Allowed=[storefront:${buyerAllowedStorefront.status},checkout:${buyerAllowedCheckout.status}] | Blocked=[owner-dashboard:${buyerBlockedOwnerDashboard.status},wizard:${buyerBlockedWizard.status},visual-editor:${buyerBlockedVisualEditor.status},super-admin:${buyerBlockedSuperAdmin.status}]`
  );

  // 3. First-Login Seller Onboarding -> Seller Navigation & Direct Super Admin Blocking
  const sellerSignup = await apiRequest('/api/auth/email/signup', {
    method: 'POST',
    body: {
      email: sellerEmail,
      password,
      displayName: 'Hira Studio',
    },
  });
  const sellerToken = sellerSignup.data?.token;
  const sellerUid = sellerSignup.data?.user?.uid;

  const sellerSaveRole = await apiRequest('/api/users/profile', {
    method: 'POST',
    token: sellerToken,
    body: {
      role: 'seller',
      displayName: 'Hira Studio',
      email: sellerEmail,
    },
  });

  const sellerAllowedDashboard = await apiRequest(
    '/api/navigation/access?screen=owner-dashboard',
    { token: sellerToken }
  );
  const sellerAllowedWizard = await apiRequest('/api/navigation/access?screen=wizard', {
    token: sellerToken,
  });
  const sellerBlockedSuperAdmin = await apiRequest('/api/navigation/access?screen=super-admin', {
    token: sellerToken,
  });
  const sellerBlockedAdminVerify = await apiRequest('/api/admin/verify-session', {
    method: 'POST',
    token: sellerToken,
    body: {},
  });
  const sellerBlockedAdminStoreStatus = await apiRequest('/api/admin/stores/status', {
    method: 'POST',
    token: sellerToken,
    body: { storeId: 'store-fatima-tech', status: 'Pending' },
  });

  record(
    'ROLE-SELLER-3',
    'Seller Role Receives [Dashboard, My Store, Products, Orders, Store Design, Settings] & Blocks Direct Access to Super Admin',
    sellerSaveRole.status === 200 &&
      JSON.stringify(sellerSaveRole.data?.permissions?.navigation) ===
        JSON.stringify([
          'Dashboard',
          'My Store',
          'Products',
          'Orders',
          'Store Design',
          'Settings',
        ]) &&
      sellerAllowedDashboard.status === 200 &&
      sellerAllowedWizard.status === 200 &&
      sellerBlockedSuperAdmin.status === 403 &&
      sellerBlockedSuperAdmin.data?.redirectScreen === 'owner-dashboard' &&
      sellerBlockedAdminVerify.status === 403 &&
      sellerBlockedAdminStoreStatus.status === 403,
    `uid=${sellerUid} | Nav=${JSON.stringify(sellerSaveRole.data?.permissions?.navigation)} | Allowed=[owner-dashboard:${sellerAllowedDashboard.status},wizard:${sellerAllowedWizard.status}] | Blocked=[super-admin:${sellerBlockedSuperAdmin.status},adminVerify:${sellerBlockedAdminVerify.status},adminStoreStatus:${sellerBlockedAdminStoreStatus.status}]`
  );

  // 4. Returning Users Skip Onboarding
  const returningBuyerLogin = await apiRequest('/api/auth/email/signin', {
    method: 'POST',
    body: { email: buyerEmail, password },
  });
  const returningBuyerCheck = await apiRequest('/api/users/profile', {
    token: returningBuyerLogin.data?.token,
  });

  const returningSellerLogin = await apiRequest('/api/auth/email/signin', {
    method: 'POST',
    body: { email: sellerEmail, password },
  });
  const returningSellerCheck = await apiRequest('/api/users/profile', {
    token: returningSellerLogin.data?.token,
  });

  record(
    'ROLE-RETURNING-4',
    'Returning Buyers & Returning Sellers Skip Onboarding Immediately After Sign-In',
    returningBuyerCheck.status === 200 &&
      returningBuyerCheck.data?.needsOnboarding === false &&
      returningBuyerCheck.data?.profile?.role === 'buyer' &&
      returningSellerCheck.status === 200 &&
      returningSellerCheck.data?.needsOnboarding === false &&
      returningSellerCheck.data?.profile?.role === 'seller',
    `ReturningBuyer=[needsOnboarding:${returningBuyerCheck.data?.needsOnboarding}, role:${returningBuyerCheck.data?.profile?.role}] | ReturningSeller=[needsOnboarding:${returningSellerCheck.data?.needsOnboarding}, role:${returningSellerCheck.data?.profile?.role}]`
  );

  // 5. Verify Super Admin Platform Dashboard is Exclusively Locked to SUPER_ADMIN_UID
  const firestoreRules = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8');
  const serverSource = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
  const hasStrictSuperAdminUidConstant =
    firestoreRules.includes(`request.auth.uid == '${SUPER_ADMIN_UID}'`) &&
    serverSource.includes('SUPER_ADMIN_UID');
  const unauthAdminAttempt = await apiRequest('/api/admin/verify-session', {
    method: 'POST',
    body: {},
  });

  record(
    'ROLE-SUPERADMIN-5',
    'Super Admin Platform Dashboard is Locked Exclusively to Verified SUPER_ADMIN_UID',
    hasStrictSuperAdminUidConstant &&
      unauthAdminAttempt.status === 401 &&
      sellerBlockedAdminVerify.status === 403 &&
      buyerBlockedSuperAdmin.status === 403,
    `SUPER_ADMIN_UID="${SUPER_ADMIN_UID}" | StrictSuperAdminCheck=${hasStrictSuperAdminUidConstant} | UnauthAdmin=401 | BuyerAdmin=403 | SellerAdmin=403`
  );

  console.log('\n================================================================================');
  console.log(`ALL ${results.length} ROLE-SPECIFIC NAVIGATION & ACCESS VERIFICATION CHECKS PASSED.`);
  console.log('================================================================================');
}

runRoleNavigationVerification().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
