# DreamStore — Deployment Readiness Checklist

**Status: READY FOR STAGING REVIEW, NOT YET APPROVED FOR PAID PRODUCTION.**

This checklist applies to the isolated PR branch `fix/launch-readiness`. Do not merge or deploy to the live DreamStore until the production gates below pass.

## Required automated checks

- TypeScript/typecheck and Vite production build.
- Static tests for authentic seller files (up to 5 MiB), pricing, checkout and download authorization.
- Firestore + Storage **emulator** rules checks, including cross-seller denial and direct buyer file access denial.
- Headless Chromium visitor flow: guest landing → sign up, Explore real stores, no direct guest dashboard, invalid store and empty-cart handling, mobile layout.
- Code-level checks for Free-plan onboarding and server-acknowledged store launch.

**Important:** These tests do NOT simulate all production Firebase Auth, named Firestore database, Cloud Run permissions, email delivery, real manual payments or real device behavior.

## Auth and runtime rollout gates

- Deploy the client and server together. A stale or rejected onboarding token now triggers Firebase sign-in recovery; selecting a role must persist successfully before entering a dashboard.
- Enable the Firebase Email/Password and Google providers. Authorize the deployed domain and its `/__/auth/handler` OAuth redirect URI. The same-origin helper proxy forwards official Firebase responses; the public cross-user relay has been removed. Test popup and redirect flows in a normal browser tab.
- Start with `npm start` on Node 22.12+ (CI uses Node 24). This forces production mode and honors Cloud Run `PORT`. Install runtime dependencies including `tsx`, and build `dist` before startup.
- Require `/api/ready` to return 200 in staging. It checks the signing secret, Firestore and Storage; `/api/health` only confirms process liveness.
- Configure `TRUST_PROXY_HOPS=1` only behind a trusted single-hop proxy that overwrites forwarded headers.
- Run `npm run test:server`: these regression tests use isolated Firebase doubles to exercise failure paths, not live credentials. Existing emulator and browser checks remain required.
- Digital checkout currently supports one product, quantity one, per order so every purchased item has a matching download entitlement. Generic payment webhooks are disabled until a verified provider adapter is implemented.

## Safe public-preview mode

The new paid checkout release flag defaults to **OFF in production**.
`DREAMSTORE_PAID_CHECKOUT_ENABLED=true` is an explicit operator-only action
reserved until all staging payment, refund, restart and original-file-download
tests have passed. When OFF, real-money checkout is rejected server-side and
the buyer UI displays a "Paid Orders Coming Soon" message **before** any wallet
instructions. Free-order downloads still require backend verification,
Firebase Admin connectivity and a persistent signing secret.

Buyer delivery emails are now required to match the authenticated buyer's
verified account email; an arbitrary recipient cannot be supplied in checkout.

## Administrator authorization setup (required for migration)

Security rules no longer embed any personal Firebase UID. They require a **verified Firebase ID token** with BOTH custom claims `role: 'super_admin'` and `superAdmin: true`. The application backend continues to require the single matching `SUPER_ADMIN_UID` configured in the service environment and cryptographically verified via Firebase Admin. This is not a user-editable Firestore profile role.

- Verify `SUPER_ADMIN_UID` and `SUPER_ADMIN_BOOTSTRAP_SECRET` are configured privately.
- Use the existing protected backend admin-bootstrap endpoint to assign both claims to the configured UID; it must report `customClaimAssigned: true`. Never publish the bootstrap secret or the UID in app pages/rules.
- The admin must **refresh their Firebase ID token / sign out and back in** after the claim is assigned.
- Confirm seller/buyer tokens without BOTH claims cannot perform admin-only reads/writes. CI emulator tests check verified and unverified claim combinations.
- Deploy updated Firestore/Storage rules only after staging tests, otherwise an existing admin account with no claims will lose access.

## Blocking production issues

1. **Production now rejects legacy temporary email sessions.** Enable Firebase Auth Email/Password and migrate/verify existing custom-email users while preserving their UIDs and ownership before rollout. Legacy accounts were stored under ephemeral OS `/tmp`; recover any available records securely before replacing instances. Test existing accounts as well as new signups. Legacy development auth requires both development mode and `DREAMSTORE_LEGACY_EMAIL_AUTH_ENABLED=true`.
2. Verify the production runtime has a **stable 32+ character `SERVER_SIGNING_SECRET`** (same across all instances, stored through a secret manager, not source code). Paid order endpoints fail closed without it.
3. Firebase Admin must have working credentials for Firebase project `dulcet-trees-qk6n5`, the **named Firestore database** `ai-studio-dreamstore-fac8084d-6f5b-423c-9b66-3ce72d622890` and Storage bucket `dulcet-trees-qk6n5.firebasestorage.app`. Merely compiling code doesn't verify runtime access.
4. **Review and deploy security rules to the correct Firestore database and Storage bucket.** `firebase.emulator.json` is for local emulators; do not assume its default database target matches production. Back up/export production documents before a rules deployment.
5. Manual wallet/UPI/Payoneer payment flows, overdue commissions, refund reconciliation, admin bulk actions and webhook ingestion still need **real end-to-end and transaction-level tests**. A transaction reference or screenshot does not verify payment; sellers must confirm actual cleared funds before unlocking downloads.
6. Verify no private/payment credentials or personal receiving numbers remain accessible in the **public Git history**, not only the latest branch. Rotate any real exposed secrets.
7. Multi-vendor digital downloads are the current supported beta. **Physical products (shipping, COD, inventory and variants) are not implemented or tested as paid checkout.** Do not advertise Shopify-level fulfillment.

## Staging smoke-test script (two separate real test accounts)

1. Sign up a seller with **Firebase Auth**, verify their email; choose Seller. Complete setup, refresh browser and ensure their store/profile persist.
2. Confirm an empty store contains **0 fake items / 0 fake visits**, starts on **Free**, and doesn't expose another seller's email or wallet.
3. Upload an actual 1 MiB and an exact 5 MiB digital file; reject 5 MiB+1 byte; compare downloaded bytes with originals. Test PDF, ZIP and DOCX.
4. Publish one free and one paid item. Buyer A must see **only published** items. Buyer B must not read private Firebase file paths or other buyer's downloads.
5. For paid test: create a pending manual payment; a screenshot/reference alone must not set Paid. Verified seller confirms funds from their actual statement; then the authenticated buyer downloads original bytes.
6. Test rejection, refund, timeout, retry/idempotency and max download count (including parallel requests and a Cloud Run restart). Ensure no paid download is unlocked before verification.
7. Restart and preferably scale Cloud Run, then retest seller/buyer login, orders, store link, payment status and download entitlement.
8. Check site on **375px mobile and desktop**: menu, signup, store wizard, product screen, cart, orders and account sign-out.
9. Examine server logs for API errors, 401/403 security checks and email sending failures. Never perform tests using customer money or production files.

## Safe release sequence

1. Review PR and current environment settings. Snapshot Firestore and record a rollback revision.
2. Verify rules and deploy to **staging first**. Validate against the correct named database and bucket.
3. Deploy backend/frontend to staging with the required secret and service-account permissions.
4. Run all staging tests, fix failures and obtain explicit release approval.
5. Only then merge PR and deploy the pinned approved commit to production; monitor health and rollback if needed.

**No merge, production rules change or live financial transaction was performed as part of these GitHub-only fixes.**
