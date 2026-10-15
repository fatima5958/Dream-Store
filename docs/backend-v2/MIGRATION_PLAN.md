# DreamStore Backend V2 — Safe Migration Plan

## Release gates

**Gate 0 (current):** V2 code isolated, modular typed interfaces, automated contract/API tests. No frontend redesign. Production and user data unchanged.

**Gate 1:** Complete the API inventory cross-check (79 statically declared baseline routes plus dynamic registrations). Complete Firestore/Storage schema + ownership mappings, ledger and legacy Buyer migration expectations.

**Gate 2:** Implement remaining modules one by one, each with API-contract, role-isolation, failure-mode and concurrency regression tests. Store/product/upload and initial financial order flows are implemented in V2. Keep all original financial logic and first-100 claim transaction semantics.

**Gate 3:** Staging with Firebase emulators or explicitly approved isolated test infrastructure, unique test identities, fresh data, no live payments, no production side-effect workers. Demonstrate Buyer signup, Seller onboarding, returning profiles, founder claims 98→99→100, idempotency, double-submit, isolation, uploads, order lifecycle and downloads.

**Gate 4:** Confirm Cloud Run service account Auth/Firestore/Storage permissions, named Firestore database, `SUPER_ADMIN_UID`, durable `SERVER_SIGNING_SECRET` and Google OAuth Web-client redirect URI. Run private staging readiness and authorized end-to-end smoke tests.

**Gate 5:** Perform data compatibility comparison and reconciliation, backup/export existing data, test rollback and coordinate a narrow canary. Obtain explicit release approval before modifying Docker startup / load balancer / AI Studio deployment.

**Gate 6:** Controlled production cutover followed by monitoring, order/commission reconciliation and rollback availability. Remove V1 only in a separately reviewed release.

## Commands (local isolated staging)

```sh
# Install Java and Firebase CLI separately, then run only the demo project.
DREAMSTORE_V2_STAGING=1 DREAMSTORE_V2_PROJECT_ID=demo-dreamstore-v2 \
SUPER_ADMIN_UID=v2-admin firebase emulators:exec \
  --project demo-dreamstore-v2 --config firebase.v2.emulator.json \
  --only auth,firestore,storage \
  "FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 npm run test:v2:emulator"

# Dependency-free deterministic repository/security checks
npm run test:v2:unit
npm run test:contracts

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

## Current rollback

No production runtime file or existing API route has been replaced. Rollback means simply stop the isolated V2 staging process; the original `scripts/start.mjs` remains active and uses the unchanged monolithic `server.ts`.

## Production credentials

Never paste Firebase ID tokens, refresh tokens, service-account secrets, passwords or cookies into issues, chat or logs. An earlier exposed session must be revoked by an authorized operator before real-account testing. This migration does not perform that action.

## Store + product phase status

- Implemented: public stores/storefront, owner restore/create/update, slug reservation, visit events, Seller product APIs, product projections, private uploads and public cover delivery.
- Locally automated: deterministic repository/unit checks and source contracts. Fake transactions model serialization and do not prove emulator behavior.
- Not verified in this environment: Express route tests, Firebase emulators, browser signup-to-published-store smoke, Vite build/typecheck, GitHub Actions. Install dependencies plus Java/Firebase CLI, then pass these before closing the milestone.
- Implemented in V2 isolated staging: compatible manual Seller payment settings, sanitized checkout instructions, server-priced durable checkout/order creation, idempotency, Buyer/Seller order isolation, Seller manual verification/refunds, durable 5% commission entries/reversal adjustments and scoped signed downloads.
- Pending: commission invoice/settlement lifecycle, Super Admin financial endpoints, gateway status/webhooks, order email notifications, Cloud IAM and deployment verification. Paid checkout remains disabled in production; no production records have changed.
