# DreamStore Backend V2 — Staging Architecture

## State: FIRST IMPLEMENTATION SLICE (not a full backend replacement)

V2 lives beside the existing `server.ts`. It has **not** replaced the production server and has not touched the approved React visual components.

```text
scripts/start-backend-v2.mjs   [explicit DREAMSTORE_V2_STAGING=1 required]
  └── server/v2/app.ts         [separate Express app, no /api proxy to V1]
       ├── modules/auth.ts    [Firebase Admin verifyIdToken(token, true)]
       ├── modules/users.ts   [role permissions, named-Firestore profile read/transactional onboarding]
       ├── modules/creators.ts[read-only, durable first-100 campaign counter]
       ├── config/firebase.ts [project-locked Admin initialization, named database, bucket, readiness]
       ├── contracts.ts       [typed dependency injection boundaries]
       └── errors.ts          [safe 401 / 403 / 409 / 503 responses]
```

## Production isolation

- The existing Dockerfile runs `scripts/start.mjs` and therefore **V1**. No dual server process, parallel webhook worker or duplicate payment processor is started.
- V2 requires `DREAMSTORE_V2_STAGING=1`; its default bind address is `127.0.0.1:8091`.
- V2 account writes are disabled unless running against a configured Firestore emulator. Production Firestore is never writable through this staging process.
- V2 only implements profile read/onboarding, Admin session verification, role-based navigation authorization, creator-count read and health/readiness. Unsupported API routes explicitly return HTTP 501.
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

- Live `/api/ready` previously returned `not_ready`. Cloud Run IAM, Firebase Storage and signing-secret configuration must be diagnosed independently.
- Google Cloud OAuth redirect URI still needs **actual Google Console** confirmation; hardcoded diagnostic lists are not proof.
- V2 store writes, orders, payments, uploads, financial transaction consistency, downloads and worker behavior are not implemented.
- Full staging integration, emulator credential isolation, cross-instance rate limiting and rollback rehearsal remain prerequisites for traffic switch.