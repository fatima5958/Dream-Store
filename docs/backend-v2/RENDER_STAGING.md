# Render Free — isolated DreamStore Backend V2 candidate (Phase 12)

**Current status (2026-10-26): API-only Backend V2 is deployed to guarded Render staging. NOT production-certified.** Render service `srv-db9h1prbc2fs73dop2k0` uses `Dockerfile.backend-v2-render`; deployment of `1bdb373f9def8299ba5af781fd9ab40eefddabe0` is marked live and startup logs contain `DreamStore V2 guarded Render staging listening.` This confirms a guarded service boot, **not** real Buyer/Seller/Admin journeys or production integration. Do not change the production V1 Dockerfile or `dreamstore.ai.studio` routing. Auto-deploy remains enabled on Render staging.

## Fixed resource identities

- Firebase staging: `tidal-axis-511800-n1` / `1013305229350`, named Firestore `dreamstore-v2-staging`.
- Approved staging-only Firebase runtime service account: `dreamstore-v2-staging-runtime@tidal-axis-511800-n1.iam.gserviceaccount.com`.
- Supabase project ref: `loyuifkrcqecjmwrohvw`, PRIVATE bucket: `dreamstore-v2-staging-files`. This Supabase project must contain synthetic-only files.
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
| `DREAMSTORE_V2_SUPABASE_URL` | `https://loyuifkrcqecjmwrohvw.supabase.co` |
| `DREAMSTORE_V2_SUPABASE_ALLOWED_PROJECT_REFS` | `loyuifkrcqecjmwrohvw` |
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

**Not verified**: real authenticated Buyer/Seller/Admin journeys, Firebase rules/IAM and token behavior in production, live file delivery and transaction recovery, browser OAuth, tenant isolation against two real test sellers, and production readiness. V2 staging boot succeeded; that does not establish continuing per-route readiness. Production V1 remains sole production writer.


## Live integration preflight (read-only; guarded staging only)

The script `npm run preflight:v2:render` targets **only**
`https://dreamstore-v2-staging.onrender.com`, refuses other origins, consumes
`DREAMSTORE_V2_RENDER_TESTER_PASSWORD` from the caller environment, and never
logs the password or session cookie. Supply the password through a private
secret-injection mechanism; **do not** paste it into chat, a shell command, a
GitHub workflow log, or the repository.

The script checks unauthenticated tester-gate denial, tester login, HTTP-only
secure cookie attributes, authenticated API health and readiness, payment
feature flags (paid checkout disabled), and denial of guest profile/admin
queries. Login attempts are limited to **one per run** to avoid repeatedly
triggering the shared rate limit. This smoke check is *not* a replacement for
two-Seller/Buyer/Admin tests, Firebase authorization checks, transaction
integrity, file storage verification, identity migration, production backup
and rollback evidence. A successful run does **not** approve production V2
traffic or paid checkout.

Render's container is API-only. The existing React frontend still imports the
production Firebase configuration; the V2 staging Auth project is different,
and the Render cookie gate requires same-origin requests. Never point the
production frontend straight at the isolated Render API or add the Render
hostname to the production Firebase allowlist to bypass the separation.

For full V2 launch, build and verify a frontend+backend release against the
**same approved production Firebase identity**, preserve existing users/stores/
order IDs and private files, compare V1/V2 data and API responses, create
recoverable backups, exercise rollback, and only then perform an approved,
pinned Cloud Run cutover with paid checkout initially disabled.
