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
| GitHub Actions | Pending push |
| Cloud staging deployment and real Auth journeys | Not run — no approved cloud resources or deployment authorization available |
| Production container smoke test | Not run — Docker unavailable in this workspace; production Dockerfile remains unchanged |

Never convert the cloud row to “passed” based on mocked tests or emulator results. Attach the Cloud Run revision, staging project/database/bucket identities, authenticated Buyer/Seller/Admin journey evidence, IAM review, audit-log review and rollback rehearsal evidence only after those actions are actually completed.
