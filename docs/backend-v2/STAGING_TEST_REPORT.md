# Backend V2 staging test report

## Phase 8 implementation scope

Cloud staging now has a separate opt-in configuration and Firebase Admin dependency factory. Configuration validation is pure and unit tested. Runtime startup verifies Cloud Run metadata project and service-account email, retrieves the staging-only signing secret through Secret Manager using the metadata identity, and probes Firebase Auth, the named Firestore database and Storage bucket. Startup refuses production identifiers, unapproved resources, emulator settings, inline credentials/secrets and paid checkout. The emulator-only factory and its guards remain separate. No frontend, V1 startup, production Dockerfile, production routing or production Firebase data was changed.

## Test evidence

Cloud configuration and metadata/Secret Manager behavior have synthetic unit coverage, including production project/database/bucket rejection, allowlist failures, missing runtime identity, emulator/credential/paid checkout rejection, failed Secret Manager access and invalid secret material. These tests mock the Google metadata and Secret Manager HTTP endpoints; they do **not** establish that a real project, IAM policy, named database, Storage bucket, OAuth configuration or Cloud Run service exists.

Local verification for the Phase 8 implementation (before GitHub Actions):

| Suite | Result |
| --- | --- |
| TypeScript (`npm run lint`) | Passed |
| V2 unit/API (`npm run test:v2`) | Passed — 85 tests |
| Contract tests (`npm run test:contracts`) | Passed — 51 tests |
| Server tests (`npm run test:server`) | Passed — 26 tests |
| Auth + named Firestore + Storage emulator | Passed — 6 integration tests |
| Firestore/Storage security rules emulator | Passed — 10 tests; expected denied-write diagnostics were emitted |
| Production frontend build (`npm run build`) | Passed; existing large-chunk warning remains |
| Local browser smoke | Blocked — Playwright Chromium executable is not installed; 9 tests could not launch |
| Production container smoke | Not run locally — Docker is unavailable; CI runs this job |
| GitHub Actions | Passed — all 3 jobs on commit `7cd61a848049daa912fe6318ae392fa728c88940`; [run 38827708475](https://github.com/fatima5958/Dream-Store/actions/runs/38827708475) |
| Cloud staging deployment and real Auth journeys | Not run — no approved cloud resources or deployment authorization available |
| Production container smoke test | Not run — Docker unavailable in this workspace; production Dockerfile remains unchanged |

Never convert the cloud row to “passed” based on mocked tests or emulator results. Attach the Cloud Run revision, staging project/database/bucket identities, authenticated Buyer/Seller/Admin journey evidence, IAM review, audit-log review and rollback rehearsal evidence only after those actions are actually completed.

GitHub Actions browser smoke and production-container jobs both passed on the same commit; the container job checked V1 liveness plus fail-closed readiness. Local browser execution was blocked by the missing Chromium binary, so CI is the browser evidence for this commit. The Docker job is the production-container evidence; no local Docker binary was available.

## Phase 9 verification (2026-10-16)

### Staging resource discovery

No approved staging Project ID or Project Number, named Firestore database, Storage bucket, Cloud Run service identity, IAM policy, or Secret Manager secret is recorded in the repository configuration or available through this workspace. `gcloud` and `firebase` CLIs are unavailable, and no authorized cloud-account connector is available. This means the existence of a separate staging project cannot be confirmed; it does not establish that no project exists. No cloud resources, IAM settings, billing, Firebase records, production deployment, or payment settings were changed.

The cloud-staging configuration was tightened to require an explicitly configured, allowlisted staging Project Number as well as the staging Project ID. It rejects the known production Project Number `582009353900` and validates the Cloud Run metadata Project Number against the configured value before requesting the signing secret. This is configuration-layer evidence only; it does not prove that cloud resources or permissions have been provisioned.

### Read-only production observations

On 2026-10-16, the existing production hostname returned HTTP 200 from `/api/health`, HTTP 503 from `/api/ready`, and HTTP 401 from an unauthenticated `/api/users/profile` request. The unauthenticated 401 is the expected auth boundary and is not evidence of a failure for a valid signed-in user. No production test identities or credentials were available, so authenticated profile access was not tested. No Cloud Run revision or sanitized Cloud Run logs were accessible; therefore the specific readiness dependency is undetermined. V1 readiness requires configured Firebase Admin/Firestore, Storage bucket access, a durable signing secret, financial readiness checks, and successful Firestore and Storage probes. The 503 alone cannot identify which check is failing.

The production OAuth diagnostics endpoint reported that the Firebase project matches production, Identity Toolkit is reachable, Google sign-in is enabled, and the production hostname is authorized. This does not establish that the Google OAuth client's exact redirect URI is registered in Google Cloud Console. That check remains a manual owner action.

### Compatibility review

No frontend source or visual design was changed. The V1 backend and production startup remain untouched. Code and contract review found that V2 restores a Seller's existing store by verified owner UID, uses the existing store identity/slug model, keeps product deliverables private behind owner-scoped Storage paths, preserves Buyer historical-order restoration by exact verified UID, retains integer minor-unit financial amounts and the 500-basis-point commission, and increments the creator campaign only on successful qualifying store creation. Signup, login, profile restoration, and updates do not claim a creator spot. This review does not read or migrate production records and is not a live production parity test.

### Phase 9 test status

The Phase 9 Project Number guard has synthetic tests for a production-number rejection, an unapproved number, and a runtime metadata number mismatch. An Auth emulator regression exercises email/password account creation, role-onboarding denial before email verification, Admin-side verification, successful Buyer/Seller onboarding, successful Seller store creation, and the invariant that Buyer signup does not change the creator count.

Local verification on the Phase 9 working tree:

| Suite | Result |
| --- | --- |
| TypeScript (`npm run lint`) | Passed |
| V2 unit/API (`npm run test:v2`) | Passed — 86 tests |
| Contract tests (`npm run test:contracts`) | Passed — 51 tests |
| Server tests (`npm run test:server`) | Passed — 26 tests |
| Auth + named Firestore + Storage emulator | Passed — 7 integration tests |
| Firestore/Storage security rules emulator | Passed — 10 tests |
| Production frontend build (`npm run build`) | Passed; existing large-chunk warning remains |
| Local browser smoke | Not rerun locally — Playwright Chromium is not installed; GitHub browser job passed |
| Local production container | Not run — Docker is unavailable; GitHub container job passed |
| Cloud staging and authenticated real-cloud journeys | Not run — no independently verifiable, authorized cloud staging resources or access |
| GitHub Actions for Phase 9 | Passed — all 3 jobs on commit `cb9f8a10c1dda3913e10b60e237fdad563203b44`; [run 38830597869](https://github.com/fatima5958/Dream-Store/actions/runs/38830597869) |

The first Auth emulator attempt exposed that the Identity Toolkit sign-up response omits `emailVerified`; the regression was corrected to query the Auth Emulator's Admin SDK user record and then passed. A separate initial emulator invocation overlapped with the security-rules emulator on the same ports; rerunning suites sequentially passed. These were harness issues, not relaxed security expectations.

Cloud staging remains blocked pending owner-provided access to a dedicated non-production Firebase/GCP project and verification of its named database, bucket, Auth providers, Cloud Run identity/IAM, Secret Manager secret, private access policy, OAuth configuration, sanitized logs, and isolated end-to-end journey evidence.


### Phase 9 extension: read-only private Cloud Run staging preflight

An additional guarded preflight script and offline regression tests were added on top of the Phase 9 staging guards. The script requires an independently approved non-production project ID/number, exact private HTTPS origin allowlist and short-lived Cloud Run invoker token. It makes six GET requests only and cannot create Firebase records, users, founder claims or payments. It rejects known production project and host identities before making network requests and prevents redirect following.

**Cloud staging execution: NOT RUN.** No approved staging project, Cloud Run service revision or authorized invoker token has been supplied. Offline mocked HTTP tests can establish the script's request/response and production-rejection behavior, not the existence or IAM correctness of cloud staging. The existing live production data and deployment remain untouched.

Check the latest GitHub Actions run for the offline preflight test result before marking it passed. Real browser/Auth, infrastructure IAM review, Cloud Logging, data parity against anonymized samples and rollback drills remain separate owner-approved tasks.

## Phase 11 — private Supabase staging adapter (2026-10-17)

Starting/latest fetched GitHub main was `b9e25782835e953c779457ceff0c0aa5e35d6c7f`. Its [Actions run 38842367837](https://github.com/fatima5958/Dream-Store/actions/runs/38842367837) was independently read through GitHub: code-quality, public-browser-smoke and production-container all completed successfully. The Phase 11 candidate adds an official Supabase Storage SDK implementation under the existing Firebase Auth/named Firestore/cloud identity guards; no production configuration, frontend source, V1 startup/Dockerfile, live data, gateway or payment flag changed.

### Local candidate evidence

| Check | Actual result |
| --- | --- |
| Frozen Bun lockfile install | Passed; no lockfile changes on frozen install |
| TypeScript `npm run lint` | Passed |
| V2 unit/repository/API `npm run test:v2` | **103 passed**, including 16 new SDK/config/API cases and a Firebase create-conflict regression |
| Offline private preflight tests | **4 passed** |
| Frontend/V1 contract tests | **51 passed** |
| V1 server runtime/security regressions | **26 passed** |
| Firebase Auth + named Firestore + Storage emulator | **8 passed**; includes real local Auth/Firestore with official Supabase SDK against a controlled HTTP double |
| Firestore/Storage rules emulator | **10 passed**; unauthorized-write assertions preserved; expected permission-denied/evaluation diagnostics emitted |
| Production Vite build | Passed; existing large-chunk warning remains |
| Local Playwright browser suite | **Blocked: 9 initialization failures** because Chromium is absent. An installation attempt returned corrupt/truncated browser ZIP files; no browser flow was executed locally |
| Local production/V2 container checks | **Not run: Docker unavailable**; baseline CI passed those checks, new-candidate CI is verified after push |
| Real private-cloud preflight | **Blocked before networking**, missing approved runtime project/origin/invoker configuration |
| Real Supabase cloud read/write/private-policy checks | **Not run**, no independently verified project URL/ref/credential configuration available to the runtime |
| Real Firebase staging/OAuth/Buyer/Seller/Admin journeys and cloud rollback | **Not run**, no approved deployed private staging service/runtime access |

Local non-browser suites total **202 passing tests**. These validate synthetic state and actual local emulator security boundaries; they do not prove cloud IAM/RLS/OAuth/deployment. The initial new-suite attempt caught two harness assumptions (a logical `public` cover namespace mistaken for the provider public endpoint, and a profile expected outside its documented `profile` JSON field); both were corrected to the actual contracts without changing authorization expectations. TypeScript caught an incorrect SDK constructor option, which was fixed against the installed official SDK.

The integration verifies UID ownership, token revocation/error handling, private cover serving, unsupported signatures/MIME/oversize/path traversal rejection, provider outage/Firestore compensation, provider/bucket-bound cleanup, pending-payment denial, Seller verification, correct unchanged 5% entry, paid/free delivery, forged/expired/replayed/cross-Buyer tokens, refund denial, archival semantics and repository/API recreation persistence. Supabase HTTP is a deterministic double; the Auth/named Firestore portion of the extra emulator journey is real local Firebase. Zero public Storage policies were added.

Two existing issues found while wiring the adapter were fixed: cloud invoice persistence now receives the same durable Secret Manager signing secret used by fulfillment, and a rejected create-only write no longer deletes the pre-existing object during compensation (both Supabase conflict and Firebase 409/412 preconditions). Private delivery additionally checks actual bytes/signature/size/version before transactionally consuming an entitlement. No commission rate or invoice policy changed.

### Owner-provided resources versus independently verified cloud evidence

- Separate Firebase project `tidal-axis-511800-n1` / `1013305229350`, named `dreamstore-v2-staging` and enabled Google/Email Auth are owner-reported / prior console screenshots. No authenticated cloud API probe was performed here.
- Dedicated service account is reported created; its exact email and least-privilege IAM were not supplied or verified.
- Supabase Free bucket `dreamstore-v2-staging-files`, PRIVATE/zero policies/50 MB ceiling are owner-reported. No project ref/URL was provided to runtime configuration. A connected GitHub integration and dashboard `main / PRODUCTION` label do not establish storage authorization or a deployment.
- Cloud signing/Supabase credential secrets, matching runtime identity, private service origin and authorized invoker access are unconfigured in this workspace. Real preflight refused to make requests. No cloud resource, billing, production data or production endpoint was changed/accessed for tests.

**Release decision: CODE IMPLEMENTED — REAL CLOUD STAGING BLOCKED.** The storage billing dependency is removed for Supabase mode; the existing Cloud Run/Secret Manager runtime requirements remain. Render Free is a researched next staging-host candidate, not an implemented runtime/deployment. See `FREE_HOSTING_REVIEW.md` and `STORAGE_CONFIGURATION.md`. Live anonymous-access tests, private cloud Auth/Storage/Firestore journeys, cloud failure/restart/cleanup and rollback evidence remain required before a production cutover review. The new commit/CI outcome is recorded after pushing; baseline CI above must not be represented as testing Phase 11.

### Phase 11 GitHub evidence

Verified code commit: `145ddbf767795d72a42345f427cc050058fa3985` (same tree as the locally tested candidate). [GitHub Actions run 38997975913](https://github.com/fatima5958/Dream-Store/actions/runs/38997975913) completed **successfully on 2026-10-17**. All three jobs passed: code-quality (including 103 V2 tests, contracts/V1 regressions and both emulator suites), public-browser-smoke, and production-container (V1 image plus separate guarded V2 image). CI supplies the browser/container evidence missing locally; it does not supply real-cloud staging evidence. Direct git transport lacked credentials; the connected GitHub app published the exact verified tree to main with an expected-parent check and no force update. No production workflow/routing/startup or Firebase resources changed.

The CI job run URLs and statuses were read from GitHub after completion. This documentation-only evidence update triggers its own CI; consult the latest main run for that final documentation commit. Cloud staging remains blocked for the configuration/access reasons above.

### Follow-up free-download retry regression

A focused duplicate-free-checkout test reproduced an existing fulfillment bug: checkout returned the persisted order number but signed a newly generated, unpersisted order/nonce, so a retry's download token was unusable. Checkout now signs `committed.order` and returns its persisted expiry. The regression requires the same order/token/expiry across duplicate submissions before fulfillment. This changes no price/commission policy and enables no paid checkout; the full 103-test V2 suite and typecheck pass after the correction. Supabase cloud remains unverified.
