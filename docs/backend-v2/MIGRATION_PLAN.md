# DreamStore Backend V2 — Safe Migration Plan

## Release gates

**Gate 0 (current):** V2 code isolated, modular typed interfaces, automated contract/API tests. No frontend redesign. Production and user data unchanged.

**Gate 1:** Complete the API inventory cross-check (79 statically declared baseline routes plus dynamic registrations). Complete Firestore/Storage schema + ownership mappings, ledger and legacy Buyer migration expectations.

**Gate 2:** Implement remaining modules one by one, each with API-contract, role-isolation, failure-mode and concurrency regression tests. Store/product/upload, order verification/refunds, 5% commissions, invoice lifecycle, Seller payment-proof submission and Super Admin settlement review are implemented in isolated V2. Keep all original financial logic and first-100 claim transaction semantics.

**Gate 3:** Staging with Firebase emulators or explicitly approved isolated test infrastructure, unique test identities, fresh data, no live payments, no production side-effect workers. Demonstrate Buyer signup, Seller onboarding, returning profiles, founder claims 98→99→100, idempotency, double-submit, isolation, uploads, order lifecycle, five-sale invoice, proof submission, Admin review, refunds and downloads. Emulator work is not equivalent to real cloud staging.

**Gate 4:** Confirm Cloud Run service account Auth/Firestore/Storage permissions, named Firestore database, `SUPER_ADMIN_UID`, durable `SERVER_SIGNING_SECRET` and Google OAuth Web-client redirect URI. Run private staging readiness and authorized end-to-end smoke tests.

**Gate 5:** Perform data compatibility comparison and reconciliation, backup/export existing data, test rollback and coordinate a narrow canary. Obtain explicit release approval before modifying Docker startup / load balancer / AI Studio deployment.

**Gate 6:** Controlled production cutover followed by monitoring, order/commission reconciliation and rollback availability. Remove V1 only in a separately reviewed release.

## Commands (local isolated staging)

```sh
# Install Java 21 and Firebase CLI separately, then run only the demo project.
DREAMSTORE_V2_STAGING=1 DREAMSTORE_V2_PROJECT_ID=demo-dreamstore-v2 \
SUPER_ADMIN_UID=v2-admin firebase emulators:exec \
  --project demo-dreamstore-v2 --config firebase.v2.emulator.json \
  --only auth,firestore,storage \
  "FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 npm run test:v2:emulator"

# Dependency-free deterministic repository/security checks
npm run test:v2:unit
npm run test:contracts

# Complete isolated Auth + named Firestore + Storage + V2 API journey
npm run test:v2:emulator

# In a second terminal, start V2 with all emulator hosts explicitly set:
DREAMSTORE_V2_STAGING=1 DREAMSTORE_V2_PROJECT_ID=demo-dreamstore-v2 \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 npm run start:backend-v2

# In a third terminal, start the frontend:
VITE_DREAMSTORE_V2_STAGING=1 VITE_DREAMSTORE_V2_PROJECT_ID=demo-dreamstore-v2 npm run dev

# Explicitly reconcile expired failed/replaced uploads (demo emulators only)
DREAMSTORE_V2_STAGING=1 DREAMSTORE_V2_PROJECT_ID=demo-dreamstore-v2 \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 npm run cleanup:v2:uploads
```

V2 uses the committed Firebase project and *named database* configuration; the emulator must be explicitly isolated from production. V2 writes require all three loopback emulators and a `demo-*` project. The frontend flag is rejected outside localhost development and never enabled in production builds. Unsupported routes return 501. **Do not switch production traffic.**

The V2 emulator journey exercises registration/onboarding, creator claim concurrency, private upload, catalog publishing, checkout idempotency and altered-key rejection, Seller payment attestation, five-sale invoice issuance, Seller proof submission, Admin settlement approval/replay rejection, refunds, download authorization, restart persistence, and Firestore/Storage rules. Test identities and payment references are synthetic. Rate limiting is process-local for this isolated Express instance and is not a production edge control.

## Current rollback

No production runtime file or existing API route has been replaced. Rollback means simply stop the isolated V2 staging process; the original `scripts/start.mjs` remains active and uses the unchanged monolithic `server.ts`.

## Production credentials

Never paste Firebase ID tokens, refresh tokens, service-account secrets, passwords or cookies into issues, chat or logs. An earlier exposed session must be revoked by an authorized operator before real-account testing. This migration does not perform that action.

## Store + product phase status

- Implemented: public stores/storefront, owner restore/create/update, slug reservation, visit events, Seller product APIs, product projections, private uploads and public cover delivery.
- Locally automated: deterministic repository/unit checks and source contracts. Fake transactions model serialization and do not prove emulator behavior.
- Not verified in this environment: Express route tests, Firebase emulators, browser signup-to-published-store smoke, Vite build/typecheck, GitHub Actions. Install dependencies plus Java/Firebase CLI, then pass these before closing the milestone.
- Implemented in V2 isolated staging: compatible manual Seller payment settings, sanitized checkout instructions, server-priced durable checkout/order creation, intent-bound idempotency, Buyer/Seller order isolation, Seller manual attestation/refunds, durable 5% commission entries and adjustments, five-sale invoices, Seller commission proof submission, Super Admin approval/rejection, and scoped signed downloads.
- Pending: real cloud staging, full frontend buyer/seller/admin browser journeys, order email notifications, subscription entitlements, Admin store controls/grants, external payment-evidence integration, distributed rate limiting, Cloud IAM verification and rollback rehearsal. Automated gateways/webhooks remain disabled. Paid checkout remains disabled in production; no production records have changed.

## Phase 5 financial API slice

- Implemented: `/api/commission/status`, `/api/commissions/invoices`, `/api/commission/invoices/issue`, `/api/commission/submit-payment`, Admin review aliases, dispute-only `/api/ledger/commission-status`, and Admin overview/config routes. Gateway status is sanitized; webhook writes return disabled 503.
- Settlement evidence has two human-declared steps: Seller attests they checked the Buyer’s external transfer; Super Admin attests cleared commission funds were independently checked. V2 has no bank/wallet integration and must not label either step provider-verified.
- Rollback: stop the emulator/V2 process. The production `scripts/start.mjs`, Dockerfile and V1 backend are unchanged. No production data needs restoration because this phase only writes synthetic emulator state.
- Release verdict: **PHASE 5 IN PROGRESS** until real isolated cloud staging, remaining endpoint/browser coverage, distributed protections and a rollback rehearsal are verified. Production cutover requires a separate explicit approval.
