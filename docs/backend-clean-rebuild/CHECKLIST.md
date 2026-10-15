# Backend clean rebuild — release blocked

Base: main at 50f14b8. Work only on backend-clean-rebuild. No production cutover.

## Implementation checklist

- [x] Inspect package manifest, screens, API calls, V1 and server/v2 staging modules.
- [ ] Reproducible dependency installation, lockfile, baseline typecheck/build/tests.
- [ ] Auth: Firebase ID tokens with revocation, verified email, configured admin UID and signed claims; HTTP negative tests.
- [ ] Stores: transactional slug reservation/founder claims, ownership, updates and returning accounts.
- [ ] Products: server-controlled metadata, immutable private uploads, authorized downloads.
- [ ] Checkout: authoritative persisted prices, currency validation, idempotent orders.
- [ ] Manual payments: private seller settings, checkout instructions, seller-only statement verification.
- [ ] Fulfillment/refunds: atomic order/entitlement/ledger transitions; 500 bps commission.
- [ ] Admin: configured identity, persistent metrics, store moderation and commission audit.
- [ ] Remove duplicate client writes; test every frontend action against staging.
- [ ] Firestore/Storage emulator isolation, buyer/seller/admin browser E2E.
- [ ] Environment template, quota/billing checks, readiness, deployment/rollback instructions.

## What is usable

React/Vite screens and visual components remain intact. V1 has the broad commerce implementation and existing financial contract tests: preserve until individually migrated. V2 has dependency-injected token verification, profiles, role permissions, public directory projection, atomic store/slug/founder-claim creation and tests. Existing docs/backend-v2/API_INVENTORY.md lists the baseline routes. V2 is NOT a replacement runtime yet: unsupported endpoints return 501 and writes are emulator-only.

## Findings requiring work

1. No lockfile; npm ci fails. Vite 8 optional esbuild peer conflicts with root esbuild 0.25; align before installing.
2. Frontend mixes API actions, Firestore subscriptions and direct metadata writes (products/deliverables/settings/profiles). Backend-only rules require coordinated changes.
3. V2 store IDs truncate UID to 20 characters; legacy compatibility and collision handling require explicit tests before migration.
4. Store creation accepts either legacy truncated or full UID IDs; update does not yet have a separate V2 route.
5. Fixed in auth slice: invalid JSON returns 400 and oversized JSON returns 413 with safe messages; HTTP-level parser integration still needs dependency installation.
6. Existing Storage rules allow overwriting private deliverables; immutable object versions are needed for verified fulfillment.
7. Existing entitlement rules allow seller writes: migration must make entitlements server-only along with checkout.
8. Existing admin rules trust signed claims, while V2 additionally checks configured UID. Align rules through trusted configuration before release.
9. Firebase rules emulator test imports @firebase/rules-unit-testing, absent from package manifest.
10. Actual cloud IAM, billing/quota, OAuth domains, bucket permissions and named database availability are unverified. No production credential or account mutation performed.

## Current execution blockers

npm registry connection timed out. Ordinary git push lacks HTTPS credentials; use the connected GitHub connector if authorized access is available. Validation: 51 source-contract checks and 10 dependency-free authentication/error unit tests pass. Full HTTP tests, typecheck, build, Firebase emulator tests and browser E2E remain blocked. npm offline install also fails: missing @oxc-project/types, get-tsconfig and media-typer cache entries. The esbuild peer fix is identified but not committed without a verified dependency installation.

## Frontend API map

| Consumer / screen | Calls |
| --- | --- |
| `src/App.tsx` | `/api/admin/verify-session`, `/api/checkout/payment-instructions/`, `/api/checkout/validate-and-prepare`, `/api/delivery/verify-download`, `/api/ledger/commission-status`, `/api/navigation/access`, `/api/navigation/access?screen=`, `/api/orders/list`, `/api/orders/refund`, `/api/orders/verify-payment`, `/api/payments/gateway-status`, `/api/products/delete`, `/api/products/upsert`, `/api/seller-settings`, `/api/stores`, `/api/stores/by-slug/`, `/api/stores/by-slug/:slug`, `/api/stores/create`, `/api/stores/update`, `/api/stores/visit`, `/api/uploads/product.`, `/api/users/profile` |
| `src/components/GeminiChatWidget.tsx` | `/api/gemini/chat` |
| `src/components/CandylandAuthModal.tsx` | `/api/auth/oauth-diagnostics?hostname=`, `/api/ready` |
| `src/lib/firebase.ts` | `/api/auth/email/reset-password`, `/api/auth/email/signin`, `/api/auth/email/signout`, `/api/auth/email/signup` |
| `src/components/screens/LandingPage.tsx` | `/api/launch/creator-spots` |
| `src/components/screens/StoreSetupWizard.tsx` | `/api/launch/creator-spots`, `/api/stores/check-slug?` |
| `src/components/screens/StoreOwnerDashboard.tsx` | `/api/commission/status?sellerId=`, `/api/commission/submit-payment`, `/api/uploads/product` |
| `src/components/screens/SuperAdminDashboard.tsx` | `/api/admin/commission-config`, `/api/admin/commission/verify-payment`, `/api/admin/stores/control`, `/api/admin/stores/status`, `/api/commission/admin/grant-pro`, `/api/commission/admin/overview` |

MobileDesignsView, ShopPage, ProductDetailPage, StorefrontHome and VisualStoreEditor delegate data actions through App callbacks. Landing/Wizard load campaign availability; owner dashboard handles files/commissions; admin dashboard handles moderation/commission settings. App owns store, product, checkout, orders and navigation state.

## Auth slice completed (unit coverage only)

- Firebase revocation checks retained; revoked/disabled/expired sessions fail closed.
- Strict bearer syntax rejects empty segments, whitespace and excessive length before verifier calls.
- Signed subject validation rejects path separators/control characters and invalid length.
- Buyer identity hints cannot target another account. Seller targets remain product-resolved commerce data.
- Configured super-admin identity still requires verified email and both signed custom claims.
- Error serializer distinguishes client parsing errors without exposing request bodies/provider secrets.
- `npm run test:auth`: 10 passing unit tests with injected verifier; no live Firebase claims made.
- `npm run test:contracts`: 51 passing source checks; not a substitute for runtime or E2E tests.

Next blocked gate: reproducible dependency installation and baseline HTTP test/build run before commerce integration. Production remains on the original runtime. No cloud, data or frontend changes in this slice.
