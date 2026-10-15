# DreamStore Backend V2 — Staging Architecture

## State: FIRST IMPLEMENTATION SLICE (not a full backend replacement)

V2 lives beside the existing `server.ts`. It has **not** replaced the production server and has not touched the approved React visual components.

```text
scripts/start-backend-v2.mjs   [explicit DREAMSTORE_V2_STAGING=1 required]
  └── server/v2/app.ts         [separate Express app, no /api proxy to V1]
       ├── modules/auth.ts    [Firebase Admin verifyIdToken(token, true)]
       ├── modules/users.ts   [role permissions, named-Firestore profile read/transactional onboarding]
       ├── modules/creators.ts[durable campaign counter]
       ├── modules/stores.ts  [owner restoration, atomic store/slug/claim]
       ├── modules/products.ts[owner catalog, public projection, publish gates]
       ├── modules/uploads.ts [5 MiB validation, immutable objects, cleanup jobs]
       ├── modules/payment-settings.ts [private owner settings, sanitized checkout projection]
       ├── modules/checkout.ts [Firestore prices, idempotency, manual payment order creation]
       ├── modules/orders.ts [Buyer/Seller isolation, manual verification, refund transitions]
       ├── modules/commissions.ts [integer-minor 500-bps commission calculation]
       ├── modules/finance-repository.ts [durable named-Firestore transactions and private file reads]
       ├── modules/downloads.ts [scoped expiring signatures, one-use authorization]
       ├── modules/policy.ts  [shared owner/email/image validation]
       ├── config/firebase.ts [project-locked Admin initialization, named database, bucket, readiness]
       ├── contracts.ts       [typed dependency injection boundaries]
       └── errors.ts          [safe 401 / 403 / 409 / 503 responses]
```

## Production isolation

- The existing Dockerfile runs `scripts/start.mjs` and therefore **V1**. No dual server process, parallel webhook worker or duplicate payment processor is started.
- V2 requires `DREAMSTORE_V2_STAGING=1`; its default bind address is `127.0.0.1:8091`.
- V2 refuses startup unless `DREAMSTORE_V2_STAGING=1`, a `demo-*` project and loopback Auth, named Firestore and Storage emulators are configured. It uses a separate Firebase Admin app. The frontend connects only with `VITE_DREAMSTORE_V2_STAGING=1` during localhost Vite development with a `demo-*` project.
- V2 implements profile/onboarding, Admin identity verification, directory/storefront, atomic Store create/update/visits, Seller products/uploads, owner payment settings, sanitized manual checkout instructions, idempotent order persistence, Seller-only manual payment verification/refunds, integer 5% commission entries, and signed private-file download authorization.
- Readiness probes Firebase Auth permissions, named Firestore reads, Storage bucket access and durable signing-secret presence; it is not merely a server liveness flag. The public response is only `ready/not_ready`.
- Never include token, password, cookies, private payment fields, Firebase credential values, or full SDK errors in logs.

## Authentication and role flow

1. Client signs in using the existing Firebase Authentication UI. The UI is unchanged in this phase.
2. V2 validates a signed Firebase ID token including revocation with Firebase Admin.
3. V2 resolves Buyer/Seller roles only from authoritative Firestore, with an ownership-verified fallback for an existing Seller store.
4. An authorized Buyer/Seller onboarding write is a Firestore transaction in isolated emulator tests only.
5. Super Admin access additionally requires server-configured UID + Firebase custom claims + email verification.
6. Invalid/revoked sessions return 401; Firebase Admin infrastructure failures return 503 without forcing client logout.

## Known blockers

- Live `/api/ready` previously returned `not_ready`. Cloud Run IAM, Firebase Storage and shared signing-secret configuration must be diagnosed independently. Staging readiness requires a stable signing secret of at least 32 characters.
- Google Cloud OAuth redirect URI still needs **actual Google Console** confirmation; hardcoded diagnostic lists are not proof.
- Cloud IAM and real deployment verification remain pending. V2 paid checkout is opt-in for isolated non-production staging and hard-blocked in production; it has not been exercised against real payment rails. Commission invoice/settlement and Super Admin financial tools remain pending. Upload cleanup requires the manual staging reconciliation script.
- Full staging integration, emulator credential isolation, cross-instance rate limiting and rollback rehearsal remain prerequisites for traffic switch.
## Public Store Directory (next implementation slice)

- `GET /api/stores` queries active stores in the existing named Firestore database; no cached demo stores are used.
- Results are capped at 100 records until paginated cursor support is built; no false claim of an exhaustive catalogue.
- A positive allowlist excludes private seller payment settings, emails and any future sensitive database fields.
- Availability/read errors return 503, never misleading `{ stores: [] }`.
- Public store-by-slug pages still need compatible product-list retrieval and ownership-safe read logic before they can migrate.


## Store, product and upload behavior

- Existing Store IDs are found by verified `ownerId` and restored to the Seller profile. New stores use `store-{first 20 UID chars}` unless that collides with an existing full-UID record. Multiple legacy stores block writes for admin review.
- First-store creation, claim, slug reservation and campaign increment commit together. Retries do not overwrite newer configuration or change the counter.
- Owner identity, status, plan, product metrics and payment settings are never accepted as seller authority. Public projections expose only storefront/listing fields.
- Product deletion uses a tombstone, retaining existing purchase history and original files. Only the owner can change products; active status is checked within each transaction.
- Upload reservation/job is persisted before bytes. Storage uses create-only random object paths; stored type/size/generation are verified. Final reference commit rechecks ownership/status. Failures compensate objects or leave a cleanup job.
- `firestore.v2.rules` and `storage.v2.rules` are emulator-only deny-by-default rules. Never deploy them over production rules in this phase.
