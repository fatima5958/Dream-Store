# DreamStore Backend V2 — Safe Migration Plan

## Release gates

**Gate 0 (current):** V2 code isolated, modular typed interfaces, automated contract/API tests. No frontend redesign. Production and user data unchanged.

**Gate 1:** Complete the API inventory cross-check (79 statically declared baseline routes plus dynamic registrations). Complete Firestore/Storage schema + ownership mappings, ledger and legacy Buyer migration expectations.

**Gate 2:** Implement the remaining modules one by one, each with API-contract, role-isolation, failure-mode and concurrency regression tests. Keep all original financial logic and first-100 claim transaction semantics.

**Gate 3:** Staging with Firebase emulators or explicitly approved isolated test infrastructure, unique test identities, fresh data, no live payments, no production side-effect workers. Demonstrate Buyer signup, Seller onboarding, returning profiles, founder claims 98→99→100, idempotency, double-submit, isolation, uploads, order lifecycle and downloads.

**Gate 4:** Confirm Cloud Run service account Auth/Firestore/Storage permissions, named Firestore database, `SUPER_ADMIN_UID`, durable `SERVER_SIGNING_SECRET` and Google OAuth Web-client redirect URI. Run private staging readiness and authorized end-to-end smoke tests.

**Gate 5:** Perform data compatibility comparison and reconciliation, backup/export existing data, test rollback and coordinate a narrow canary. Obtain explicit release approval before modifying Docker startup / load balancer / AI Studio deployment.

**Gate 6:** Controlled production cutover followed by monitoring, order/commission reconciliation and rollback availability. Remove V1 only in a separately reviewed release.

## Commands (local isolated staging)

```sh
npm run test:v2
DREAMSTORE_V2_STAGING=1 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run start:backend-v2
```

V2 uses the committed Firebase project and *named database* configuration; the emulator must be explicitly isolated from production. Until the remaining APIs are migrated, the V2 process intentionally returns 501 for unsupported routes. **Do not switch frontend or production traffic.**

## Current rollback

No production runtime file or existing API route has been replaced. Rollback means simply stop the isolated V2 staging process; the original `scripts/start.mjs` remains active and uses the unchanged monolithic `server.ts`.

## Production credentials

Never paste Firebase ID tokens, refresh tokens, service-account secrets, passwords or cookies into issues, chat or logs. An earlier exposed session must be revoked by an authorized operator before real-account testing. This migration does not perform that action.