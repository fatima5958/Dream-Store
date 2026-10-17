# Render Free — isolated DreamStore Backend V2 candidate (Phase 12)

**Status: CODE CANDIDATE ONLY, NOT DEPLOYED.** The existing Render Free service continues to use `./Dockerfile` and starts V1. Never change the production V1 Dockerfile or `dreamstore.ai.studio` routing for this staging work. Auto-deploy ON means changes to `main` will rebuild **the currently configured V1 image**; the new V2 image must be selected only after complete staging secrets and gate review.

## Fixed resource identities

- Firebase staging: `tidal-axis-511800-n1` / `1013305229350`, named Firestore `dreamstore-v2-staging`.
- Approved staging-only Firebase runtime service account: `dreamstore-v2-staging-runtime@tidal-axis-511800-n1.iam.gserviceaccount.com`.
- Supabase project ref: `loyuifkrcqecjmwrohwv`, PRIVATE bucket: `dreamstore-v2-staging-files`. This Supabase project must contain synthetic-only files.
- Render Free service: `DreamStore-V2-Staging` at `https://dreamstore-v2-staging.onrender.com`.
- Live production Firebase `dulcet-trees-qk6n5` and project number `582009353900` are never valid staging targets.

## Secret handling and owner approval

Render Free managed OIDC is not an available Google Cloud credential source. This candidate supports **only** a dedicated staging service-account JSON in Render's Secret File named `dreamstore-v2-staging-firebase.json` (runtime path `/etc/secrets/dreamstore-v2-staging-firebase.json`), with narrow project-level IAM, key rotation and revocation procedure. Long-lived keys carry risk: **do not create/upload a key without explicit owner approval**, and never use a production credential. Never submit the JSON or keys to a chat, commit, or log.

Set the following **server-only** Render environment keys *after owner approval*, using unique high-entropy secrets. Save changes only after confirming provider identities and access controls:

| Key | Value |
| --- | --- |
| `DREAMSTORE_V2_STAGING` | `1` |
| `DREAMSTORE_V2_MODE` | `render-staging` |
| `DREAMSTORE_V2_STORAGE_PROVIDER` | `supabase` |
| `DREAMSTORE_V2_RENDER_ORIGIN`, `DREAMSTORE_V2_RENDER_ALLOWED_ORIGINS` | `https://dreamstore-v2-staging.onrender.com` |
| `DREAMSTORE_V2_RENDER_PROJECT_ID`, `DREAMSTORE_V2_RENDER_ALLOWED_PROJECT_IDS` | `tidal-axis-511800-n1` |
| `DREAMSTORE_V2_RENDER_PROJECT_NUMBER`, `DREAMSTORE_V2_RENDER_ALLOWED_PROJECT_NUMBERS` | `1013305229350` |
| `DREAMSTORE_V2_RENDER_DATABASE_ID`, `DREAMSTORE_V2_RENDER_ALLOWED_DATABASE_IDS` | `dreamstore-v2-staging` |
| `DREAMSTORE_V2_SUPABASE_URL` | `https://loyuifkrcqecjmwrohwv.supabase.co` |
| `DREAMSTORE_V2_SUPABASE_ALLOWED_PROJECT_REFS` | `loyuifkrcqecjmwrohwv` |
| `DREAMSTORE_V2_SUPABASE_BUCKET`, `DREAMSTORE_V2_SUPABASE_ALLOWED_BUCKETS` | `dreamstore-v2-staging-files` |
| `DREAMSTORE_V2_RENDER_SUPABASE_SECRET_KEY` | Unique approved private staging server key (NEVER `VITE_`) |
| `DREAMSTORE_V2_RENDER_SIGNING_SECRET` | New staging-only random secret (40+ chars) |
| `DREAMSTORE_V2_RENDER_TESTER_PASSWORD` | **Different** staging-only random tester password (24+ chars) |
| `SUPER_ADMIN_UID` | Unique synthetic Firebase staging Admin UID |

Do not configure Cloud Run `K_*` identity, Secret Manager envs, production Firebase, `GOOGLE_APPLICATION_CREDENTIALS`, or any emulator settings. Do not enable paid checkout, AI, or live gateways.

The temporary tester gate uses a same-origin, HMAC-signed Secure HttpOnly SameSite=Strict cookie, blocks all API endpoints without a valid session, and does not replace Firebase Buyer/Seller identity verification. Login path is `/__staging/login`. The test-only gate does not provide private network ingress; it should never be used for production traffic. Request throttling is per process, not an edge-wide distributed firewall.

**Build candidate separately**: `docker build -f Dockerfile.backend-v2-render .`
Startup command is `node scripts/start-backend-v2-render.mjs`, not the V1 server and not the Cloud Run staging entrypoint. Production app frontend is intentionally not included in this API-only candidate.

## Verification gates before switching Render Dockerfile

1. GitHub CI lint, backend V2, contract, emulator and V1 tests pass.
2. Owner explicitly reviews potential staging Firebase service-account key risk and enables only least-privilege IAM permissions.
3. Configure Render secrets privately without exposing their values.
4. Verify the Supabase bucket is private and project/ref are correct; review RLS and anonymous access separately.
5. Only then select `./Dockerfile.backend-v2-render` in Render settings and deploy with owner approval.
6. Confirm startup with real staging Auth, named Firestore and private Supabase, through tester gate; verify `/api/ready=200`.
7. Run synthetic Buyer/Seller/Admin journeys and cross-account denial; review storage consistency, cold-start and rollback.

**Not verified**: Render live V2 boot, service-account IAM, real Firebase Auth/Firestore, live Supabase, OAuth email verification and browser journeys, tenant-isolation in cloud, production readiness. Production V1 remains sole production writer.
