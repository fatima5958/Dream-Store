# DreamStore production release status

**Status: NOT CERTIFIED FOR PAID PRODUCTION.** This is a truthful release gate, not a claim that automated CI proves a live launch is safe. The intended GitHub branch is `main`; production deployment must be a separate approved, pinned Cloud Run revision.

## Code-level work completed

- Verified Firebase identity for seller/buyer/admin routes, durable store ownership enforcement and slug reservations
- Firebase emulator security rules tests, browser smoke tests, container build and typecheck in GitHub Actions
- Durable payment-proof submission, atomic invoice settlement, idempotent commission invoice issuance and refund adjustments
- Pro entitlement checks reloaded from authoritative records; production test-only invoice mutation disabled
- Free products and secure downloads protected by buyer identity

## Release blockers that require the actual infrastructure and real staging identities

1. Confirm the **production** named Firestore database and Storage bucket actually have the reviewed rules deployed, with two separate sellers, a buyer and the single administrator tested end to end.
2. Configure production Cloud Run service account IAM, verified Firebase sign-in providers / authorized domain, stable signing secret and private administrator UID and bootstrap secret; verify deployment has no missing env values.
3. Back up production documents and **migrate/recover legacy ephemeral email accounts** while preserving existing UIDs and store ownership.
4. Run real staging transactions with controlled test funds: manual payment received and separately statement-verified; rejected/refunded/partial commissions; full order download/revocation; restart and multi-instance reconciliation, including concurrent payments.
5. Confirm that historical Git commits and deployments contain no exposed wallets, personal receiving details, keys or secrets; rotate and revoke anything exposed.
6. Verify the actual Cloud Run revision and domain, test desktop/mobile devices, log alerts, backup restoration and one-click rollback.
7. Confirm gateway integration scope: generic payment webhooks remain intentionally rejected and physical shipping/fulfillment is not implemented. Never market those as ready.

## How to verify the deployed staging service

Run `npm run release:preflight -- https://YOUR-STAGING-URL` from a trusted terminal. This checks live readiness and unauthenticated API denial without making transactions or sending credentials. A green result covers **only those network assertions**; it does not replace the staging tests and release blockers above.

**Paid production approval condition:** All live release gates above must be independently evidenced and signed off by the project owner. Until then keep `DREAMSTORE_PAID_CHECKOUT_ENABLED=false` and do not process customer money through the release.
