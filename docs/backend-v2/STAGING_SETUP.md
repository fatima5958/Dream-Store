# DreamStore Backend V2 Staging Setup

## Current supported mode: local Firebase emulators only

V2 currently refuses non-emulator environments. This is intentional. `scripts/start-backend-v2.mjs` requires `DREAMSTORE_V2_STAGING=1`, a `DREAMSTORE_V2_PROJECT_ID` matching `demo-*`, and loopback Auth, Firestore and Storage emulator hosts. A Cloud Run deployment must not use fake loopback hosts or relaxed guards.

The verified local command is:

```sh
DREAMSTORE_V2_STAGING=1 DREAMSTORE_V2_PROJECT_ID=demo-dreamstore-v2 SUPER_ADMIN_UID=v2-admin \
npx firebase-tools emulators:exec --project demo-dreamstore-v2 \
  --config firebase.v2.emulator.json --only auth,firestore,storage \
  "DREAMSTORE_V2_STAGING=1 DREAMSTORE_V2_PROJECT_ID=demo-dreamstore-v2 SUPER_ADMIN_UID=v2-admin FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 npm run test:v2:emulator"
```

The command uses synthetic users and the configured named database. Never change the demo project ID to the production project (`dulcet-trees-qk6n5`) or point an emulator test at real Firebase endpoints.

## Cloud staging status: blocked, runtime mode not implemented

There is no approved dedicated staging Firebase project or verified Cloud Run service identity available in this implementation session. The current runtime does not support Cloud staging and must not be deployed to Cloud Run by bypassing emulator checks. Cloud staging requires a separately reviewed mode with all of these controls before code can enable it:

1. Dedicated Firebase project ID, explicitly allowlisted and different from `dulcet-trees-qk6n5`.
2. Separate named Firestore database and Storage bucket with no imported production customer data.
3. Dedicated Cloud Run service account; runtime must verify its actual metadata identity against the configured allowlist.
4. Separate Firebase Admin application configured to the staging project and named database. Auth, Firestore, Storage and bucket configuration must all match the allowlisted staging project.
5. Fail-closed refusal of emulator environment variables, production project IDs, production bucket/database identifiers, or any identity mismatch.
6. Paid checkout, automated gateways and webhook processing disabled. No V1 production deployment or frontend routing change.
7. Stable staging-only `SERVER_SIGNING_SECRET` held in Secret Manager. Never reuse production signing keys. Do not set `DREAMSTORE_V2_GEMINI_ENABLED` unless usage/quota policy has been explicitly reviewed; keep `GEMINI_API_KEY` in Secret Manager if used.

### Least-privilege identity permissions to validate

The staging service account should receive only permissions on the staging project/database/bucket:

- Firebase Authentication read/user lookup needed for ID-token revocation verification (`roles/firebaseauth.viewer`, or a custom role with the exact required `firebaseauth.users.get`/list permissions).
- Firestore data access for the dedicated named database (`roles/datastore.user`, or a narrower custom role).
- Cloud Storage object access only to the staging bucket (`roles/storage.objectAdmin` scoped to that bucket; tighten after validating upload/delete needs).
- Cloud Run logging write permission (`roles/logging.logWriter`).

The deployer needs permission to deploy the staging Cloud Run service and attach only the dedicated service account. These IAM grants have not been applied or tested. Review actual required permissions against Cloud Audit Logs before any staging traffic.

## Future deployment verification gates

Before enabling a cloud-staging runtime mode, add tests that verify actual Cloud Run metadata identity, Firebase Admin project, Firestore database ID, Storage bucket project, and refusal of production identifiers. Then deploy a private staging service with no public ingress, run `/api/health` and `/api/ready`, execute synthetic Buyer/Seller/Admin API journeys, inspect Cloud Audit Logs for writes, and rehearse stopping the service. Emulator success does not satisfy those checks.

Current environment variables understood by emulator V2 include `DREAMSTORE_V2_STAGING`, `DREAMSTORE_V2_PROJECT_ID`, `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`, `FIREBASE_STORAGE_EMULATOR_HOST`, `SUPER_ADMIN_UID`, and `SERVER_SIGNING_SECRET`. `DREAMSTORE_V2_GEMINI_ENABLED` plus `GEMINI_API_KEY` are optional, disabled by default, and should not be added to a deployment without a separate usage review. There is no supported cloud-mode environment-variable set yet.
