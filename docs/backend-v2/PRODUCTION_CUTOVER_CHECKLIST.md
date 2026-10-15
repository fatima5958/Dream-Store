# Backend V2 Production Cutover Checklist

**Status: NOT APPROVED. V1 remains the production backend.** Passing CI or local emulators is not a production-readiness approval.

## Required before any cutover proposal

- [ ] Complete Phases 1–7 and close or explicitly accept every API-inventory blocker.
- [ ] Provision and independently verify a dedicated cloud-staging Firebase project, named database, bucket and Cloud Run service identity. Prove runtime refusal for production project/database/bucket identities.
- [ ] Configure dedicated Secret Manager secrets for staging; verify rotation, access boundaries and durable signing behavior. Never copy production signing credentials into staging.
- [ ] Validate Firebase Auth verification/revocation, email verification and Google OAuth domains/redirect URIs with synthetic staging identities.
- [ ] Run authenticated Buyer signup/login/refresh/returning-order, Seller onboarding/store/product, and Super Admin audit/suspend/restore journeys against cloud staging.
- [ ] Complete object-level access testing, Firestore/Storage rules tests, rate-limit/load checks, failure injection, restart persistence and transaction concurrency checks.
- [ ] Review Cloud Audit Logs and reconcile test ledger, invoice, dispute, adjustment, subscription and audit records. No test/customer identity crossover is permitted.
- [ ] Obtain external evidence/review for manual payment verification and commission settlement flows. Automated gateways, webhooks and paid checkout stay disabled until separately approved and integrated.
- [ ] Configure email delivery only after provider, consent, security and failure behavior are reviewed; status-only responses do not count as delivery.
- [ ] Compare V1 and V2 API/data contracts on a read-only anonymized dataset; verify store IDs/slugs, product metadata, status semantics, currency/minor-unit amounts, order/download rights and Admin identity.
- [ ] Rehearse rollback: stop V2 traffic, restore V1 routing, preserve V2 staging exports for reconciliation, and verify no duplicate order/payment processing.
- [ ] Obtain explicit written release approval before changing production startup, Dockerfile, hosting route, AI Studio deployment or Firebase write target.

## Cutover controls

Keep V1 as the sole active production writer until every gate above has evidence and an approved change window. Do not import emulator fixtures, rewrite ledger/invoices, migrate user roles in bulk, or enable paid checkout during a cutover. If any authorization, data parity, payment or rollback check fails, stop the V2 rollout and keep V1 active.
