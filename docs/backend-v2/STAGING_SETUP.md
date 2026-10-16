# DreamStore Backend V2 staging setup

## Supported modes

V2 has two explicitly separate staging modes. The existing emulator path remains unchanged: `scripts/start-backend-v2.mjs` requires `DREAMSTORE_V2_STAGING=1`, a `demo-*` project and loopback Auth, Firestore and Storage emulator hosts. The Cloud Run mode is selected only with `DREAMSTORE_V2_MODE=cloud-staging`; it does not use the emulator config or production Dockerfile. Both modes keep automated gateways, webhooks and paid checkout disabled.

No Cloud Run deployment or real cloud staging verification has been performed from this workspace. The repository contains no approved staging project or IAM setup. Do not create billable resources without owner approval.

## Emulator test command

```sh
DREAMSTORE_V2_STAGING=1 DREAMSTORE_V2_PROJECT_ID=demo-dreamstore-v2 SUPER_ADMIN_UID=v2-admin \
npx firebase-tools emulators:exec --project demo-dreamstore-v2 \
  --config firebase.v2.emulator.json --only auth,firestore,storage \
  "DREAMSTORE_V2_STAGING=1 DREAMSTORE_V2_PROJECT_ID=demo-dreamstore-v2 SUPER_ADMIN_UID=v2-admin FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 npm run test:v2:emulator"
```

This command uses synthetic identities and the named database from `firebase.v2.emulator.json`. Never set it to `dulcet-trees-qk6n5` or point emulator tests at real Firebase endpoints.

## Cloud staging security model

`server/v2/config/cloud-staging.ts` checks explicit activation, exact project/database/bucket/service/Secret Manager allowlists, Cloud Run runtime metadata project and service-account identity, and the staging signing secret. It rejects the production Firebase project, production database/bucket identifiers from the repository config, default Firestore database, emulator variables, inline signing secrets, credential-file variables, paid checkout and optional Gemini activation. It requires a Cloud Run service and revision identity. The runtime initializes Firebase Admin with only the allowlisted staging project, named database and staging bucket; it never initializes the production project. Startup probes Auth, that named database, and the selected bucket. Readiness returns only `ready`/`not_ready`; logs include only a coarse error category.

Set these Cloud Run environment variables only after a dedicated project and resources have been independently reviewed:

| Variable | Required value |
| --- | --- |
| `DREAMSTORE_V2_STAGING` | `1` |
| `DREAMSTORE_V2_MODE` | `cloud-staging` |
| `DREAMSTORE_V2_CLOUD_STAGING_PROJECT_ID` | Dedicated staging Firebase/GCP project ID; must not be `dulcet-trees-qk6n5` |
| `DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_PROJECT_IDS` | Comma-separated exact project allowlist, including only the intended staging project |
| `DREAMSTORE_V2_CLOUD_STAGING_DATABASE_ID` | Dedicated non-default Firestore database ID |
| `DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_DATABASE_IDS` | Exact named database allowlist |
| `DREAMSTORE_V2_CLOUD_STAGING_STORAGE_BUCKET` | Dedicated staging Storage bucket |
| `DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_STORAGE_BUCKETS` | Exact bucket allowlist |
| `DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_SERVICES` | Exact Cloud Run service name allowlist |
| `DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_SERVICE_ACCOUNTS` | Exact Cloud Run runtime service-account email allowlist |
| `DREAMSTORE_V2_CLOUD_STAGING_SIGNING_SECRET_NAME` | Secret Manager secret ID containing `staging` |
| `DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_SIGNING_SECRET_NAMES` | Exact staging secret ID allowlist |
| `SUPER_ADMIN_UID` | The configured staging Super Admin Firebase UID |

Cloud Run's metadata server must report the same project ID as the Firebase target and a service account included in the allowlist. `GOOGLE_CLOUD_PROJECT`/`GCLOUD_PROJECT`, if set, must match. Grant the runtime identity access to only the staging project resources and the named staging secret. Never configure any `*_EMULATOR_HOST`, `SERVER_SIGNING_SECRET`, `DOWNLOAD_SIGNING_SECRET`, `TOKEN_SIGNING_SECRET`, `GOOGLE_APPLICATION_CREDENTIALS` or `FIREBASE_CONFIG` in cloud mode. Do not set the paid-checkout or Gemini flags.

### Owner provisioning steps (Google Cloud Console)

1. **Project selector → New project**: provision a dedicated staging project. Do not import production customer data. Attach Firebase only to this project.
2. **Firebase Console → Authentication → Sign-in method**: enable only the providers under test. **Authentication → Settings → Authorized domains**: add the staging web origin. Separately check Google OAuth client redirect URI registration in **Google Cloud Console → APIs & Services → Credentials**; Firebase Authorized Domains do not establish redirect URI registration.
3. **Firestore Database → Add database**: create the dedicated named database and deploy the repository's restrictive Firestore rules/indexes after reviewing environment-specific references. **Storage → Get started**: create the dedicated bucket and deploy restrictive Storage rules. Do not copy production data.
4. **IAM & Admin → Service Accounts**: create a dedicated Cloud Run runtime identity. Grant only the minimum Auth token verification/revocation permissions, named Firestore data access, bucket-scoped object permissions, logging, and Secret Manager access to the one staging signing secret. Do not use a downloaded service-account key.
5. **Secret Manager → Create secret**: create a unique random staging signing secret with at least 32 characters. Add a version and grant Secret Manager Secret Accessor on this one secret to the runtime identity. Do not paste the secret into a ticket, chat, or environment variable.
6. **Cloud Run → Create service**: deploy only after owner approval for any billable build/runtime resources. Use a private service requiring authentication, attach the dedicated service identity, configure the variables above, and set the container command to `node scripts/start-backend-v2.mjs`. Do not alter the production Dockerfile, V1 startup, AI Studio routing or live Firebase configuration.

For a reviewed deployment from a local checkout, the operator can use the Cloud Console or `gcloud run deploy dreamstore-v2-staging --source . --region REGION --project STAGING_PROJECT --service-account RUNTIME_SA --no-allow-unauthenticated --command node --args scripts/start-backend-v2.mjs`. Add only the environment variables from the table; do not set credential or signing-secret values. This command can incur Cloud Build/Run charges and is intentionally not run as part of repository tests.

## Safe checks after an approved private deployment

```sh
curl -fsS "$STAGING_URL/api/health"
curl -i "$STAGING_URL/api/ready"
```

`/api/ready` must return `200` only after Auth, named Firestore and Storage access pass. Test with synthetic Firebase identities and a short-lived authorized Cloud Run identity token; never make the service public. Verify in **Cloud Logging → Logs Explorer** and **Logging → Audit Logs** that all resource names belong to staging and no secret/token/PII values were logged. Cloud readiness code does not by itself prove IAM least privilege, OAuth redirect setup, tenant isolation, or browser authentication.

## Stop and rollback

For a staging issue, disable ingress or set the Cloud Run service minimum traffic to zero/disable the revision, revoke that runtime identity's staging grants, and preserve logs for review. No frontend or production routing points to V2. V1 remains the production backend. Do not delete staging Firestore/Storage data before exporting the synthetic test evidence needed for investigation.
