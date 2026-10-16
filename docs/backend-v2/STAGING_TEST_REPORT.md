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
