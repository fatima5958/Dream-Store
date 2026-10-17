# DreamStore Backend V2 — Safe Migration Plan

## Release gates

**Phase 7 status:** read-only legacy Buyer restoration, safe OAuth-diagnostics compatibility, and bounded guest assistant compatibility are implemented and under isolated emulator/API verification. Cloud staging remains blocked until a dedicated staging Firebase project and Cloud Run service identity are provisioned and reviewed. This is not a cloud staging approval or production readiness statement.

**Gate 0 (current):** V2 code isolated, modular typed interfaces, automated contract/API tests. No frontend redesign. Production and user data unchanged.

**Gate 1:** Complete the API inventory cross-check (79 statically declared baseline routes plus dynamic registrations). Complete Firestore/Storage schema + ownership mappings, ledger and legacy Buyer migration expectations.

**Gate 2:** Implement remaining modules one by one, each with API-contract, role-isolation, failure-mode and concurrency regression tests. Store/product/upload, order verification/refunds, 5% commissions, invoices/settlement, disputes, Admin store controls, Free/Pro entitlements and safe read contracts are implemented in isolated V2. Keep all original financial logic and first-100 claim transaction semantics.

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

The V2 emulator journey exercises registration/onboarding, creator claim concurrency, private upload, catalog publishing, checkout idempotency and altered-key rejection, Seller payment attestation, five-sale invoice issuance, Seller proof submission, Admin settlement approval/replay rejection, dispute listing/resolution races, Admin Store suspension/reactivation, Pro waitlist/grant/revoke, refunds, download authorization, restart persistence and Firestore/Storage rules. Test identities and payment references are synthetic. Rate limiting is process-local for this isolated Express instance and is not a production edge control.

## Current rollback

No production runtime file or existing API route has been replaced. Rollback means simply stop the isolated V2 staging process; the original `scripts/start.mjs` remains active and uses the unchanged monolithic `server.ts`.

## Backend replacement track (current)

The separate `Dockerfile.backend-v2` builds a V2 staging candidate without changing the production `Dockerfile`; CI builds it and verifies that it refuses to start without explicit isolated-staging configuration. This is a deployable staging artifact, not a production image approval.

Replace V1 only in this order:

1. Owner identifies and authorizes a dedicated non-production Firebase/GCP project, named database, bucket, Cloud Run identity and signing secret. Deploy the candidate as a private staging service; do not point the existing frontend or production service at it.
2. Resolve the current V1/V2 compatibility gaps in `API_INVENTORY.md`, especially legacy server-auth fallback and any V1 routes still returning truthful 501/503. Keep Firebase Web SDK auth as the identity source; do not restore a parallel password store.
3. Run the full authenticated cloud Buyer/Seller/Admin journeys, ownership/rules checks, persistence/restart tests, payment-disabled checks, and rollback rehearsal against synthetic staging users and records.
4. Compare V1/V2 behavior against a read-only, anonymized contract fixture. Confirm frontend same-origin routing for every API call; do not export production user/financial documents to staging.
5. Prepare a narrow production change that changes only the backend route after readiness, owner approval and a rollback window are documented. Preserve V1 runtime/image as an immediate rollback target. Reconcile orders/commissions before any V1 retirement.

Current blocker: there is no verified staging project or Cloud Run service, `/api/ready` on production returned 503 during the last read-only check, and its sanitized Cloud Run logs/revision are unavailable here. Existing CI and emulator success do not satisfy steps 1 or 3. Do not replace `scripts/start.mjs`, the production Dockerfile, or production routing until those blockers and all checklist gates are closed.

## Production credentials

Never paste Firebase ID tokens, refresh tokens, service-account secrets, passwords or cookies into issues, chat or logs. An earlier exposed session must be revoked by an authorized operator before real-account testing. This migration does not perform that action.

## Phase 6 validation status

- Implemented: public stores/storefront, owner restore/create/update, slug reservation, visit events, Seller product APIs, product projections, private uploads and public cover delivery.
- Implemented: compatible manual Seller payment settings, sanitized checkout instructions, server-priced order creation/idempotency, Buyer/Seller isolation, manual verification/refunds, fixed 5% commissions, five-sale invoices, Admin settlement and disputes, Admin store moderation, Pro entitlements/waitlist, scoped ledger, redacted notification status and Payoneer manual readiness.
- Emulator coverage: synthetic Auth users, named Firestore and Storage test store/order flows, invoice dispute and concurrent Admin decisions, admin store suspension/reactivation, Pro waitlist/grant/revoke, creator limit and private Storage rules.
- Pending: real cloud staging, complete authenticated Buyer/Seller/Admin browser journeys, external payment evidence integration, email delivery, distributed rate limiting, Cloud IAM verification and rollback rehearsal. Automated gateways/webhooks remain disabled. Paid checkout remains disabled in production; no production records have changed.

## Phase 5–6 financial API slices

- Implemented: `/api/commission/status`, `/api/commissions/invoices`, `/api/commission/invoices/issue`, `/api/commission/submit-payment`, Admin review aliases, `/api/ledger/commission-status`, Admin dispute listing/resolution, Admin Store controls, Pro subscription grants/status/waitlist, `/api/ledger`, `/api/ledger/transactions`, order notification status and Payoneer readiness. Gateway status is sanitized; webhook writes return disabled 503.
- Settlement evidence has two human-declared steps: Seller attests they checked the Buyer’s external transfer; Super Admin attests cleared commission funds were independently checked. V2 has no bank/wallet integration and must not label either step provider-verified.
- Approved disputes against unpaid invoices adjust only unpaid integer minor units. Paid or partially paid invoice balances remain unchanged and require explicit human reconciliation; no automatic credit/refund is created.
- Rollback: stop the emulator/V2 process. The production `scripts/start.mjs`, Dockerfile and V1 backend are unchanged. No production data needs restoration because this phase only writes synthetic emulator state.
- Release verdict: **PHASE 6 IN PROGRESS** until independent cloud staging, authenticated Buyer/Seller/Admin flows, distributed protections and rollback rehearsal are verified. Production cutover requires a separate explicit approval.

## Phase 7 compatibility slice

- Implemented: legacy Buyer profile restoration on exact verified Firebase UID → historical `ledger.buyerId`, read-only projection; V1 Seller restore remains based on exact Store ownership. Existing role docs cannot fall through to historical role inference.
- Implemented: V2 OAuth diagnostics compatibility response reports external Firebase/Google registration as unqueried/unavailable; V2 never probes the production project's public API key from emulator staging.
- Implemented: guest Gemini chat validation and local fallback; configured model calls are gated by `DREAMSTORE_V2_GEMINI_ENABLED=true` plus a server-only API key, with capped input/output, per-process rate limit, concurrency limit and timeout.
- Replaced: email signup, signin, verification, reset and signout remain in Firebase Web SDK. V2 legacy server-password endpoints, password migration/reset tokens and server sessions stay unsupported. Admin bootstrap, internal runtime test suite and overdue simulation remain intentionally disabled.
- Cloud staging deployment is not configured or verified. Current V2 startup remains emulator-only; do not supply live credentials to pass this guard. See `STAGING_SETUP.md` for provisioning and validation steps.
## Phase 11 — Supabase staging provider

An explicitly selected private Supabase bucket can replace Firebase Storage only in the guarded V2 cloud-staging dependency factory. Emulator staging still uses Firebase Storage emulator; V1/production targets remain unchanged. No migration is automatic: references/jobs bind to a provider/bucket, and legacy Firebase references fail closed under Supabase. Use only fresh synthetic staging objects. Reverting the provider flag never moves or deletes files; retain matching configuration to reconcile pending uploads. The owner must verify live bucket privacy/RLS, credentials, cloud identity, Auth/Firestore access and signed entitlement delivery before any release proposal. A free Render runtime is researched but not implemented; until separately reviewed, local emulator/SDK-double validation is the available no-billing path.
