# Backend V2 — Data Compatibility Contract

**Existing project and database remain authoritative.** Firebase project: `dulcet-trees-qk6n5`; named Firestore database is read from `firebase-applet-config.json` (do not substitute `(default)`). Existing Firebase Authentication users and Storage paths are never reset.

## Firestore collection names observed in `server.ts`

- `checkout_idempotency`
- `commission_adjustments`
- `commission_invoices`
- `commission_payment_refs`
- `commission_payments`
- `consumedResetTokens`
- `creator_launch_campaigns`
- `creator_launch_claims`
- `deliverables`
- `ledger`
- `ledger_audit`
- `order_email_notifications`
- `orders`
- `private`
- `products`
- `sellerSettings`
- `store_slugs`
- `stores`
- `subscriptions`
- `users`

These are source-observed collection calls; nested collections, REST paths, and dynamically constructed paths need an additional complete schema audit before cutover.

## User profile compatibility (`users/{firebaseUid}`)

- Signed Firebase UID is the sole document key; email comes from the verified Firebase token.
- Roles `buyer` and `seller` are stored in Firestore, not trusted from localStorage.
- Existing fields: `uid`, `role`, `displayName`, `email`, `onboardingCompleted`, optional `storeId`, `createdAt`, `updatedAt`.
- API profile response includes `createdAtIso`, `updatedAtIso`, `needsOnboarding`, and role `permissions`.
- Seller store identifiers use the existing `store-` + first 20 characters of Firebase UID convention; verify actual `ownerId` on the stored document.
- A verified Admin role requires both matching `SUPER_ADMIN_UID` and signed Firebase custom claims. A Firestore field alone never grants privileged access.
- V2 currently restores a legacy seller who has a matching **owned** `stores/{canonicalStoreId}` document. Returning buyers found only through historic ledger records still require an isolated migration/compatibility test; V1 stays authoritative until that is complete.

## Creator launch atomicity

- Campaign: `creator_launch_campaigns/first-100-creators` (`claimedCount`, `limit`).
- Claim identity: `creator_launch_claims/{verifiedOwnerUid}`.
- Store slug reservation: `store_slugs/{storeSlug}`.
- All original store creation, slug uniqueness, campaign counter update, and claim creation stay in one Firestore transaction in V1, not in V2 yet.
- V2 implements **read-only** `GET /api/launch/creator-spots` with actual counter; it cannot make creator claims. Signup and returning login never consume creator spots.

## Finance and private customer records

- Preserve existing `orders`, `ledger`, `ledger_audit`, `commission_invoices`, `commission_payments`, `commission_payment_refs`, `commission_adjustments`, `subscriptions`, `sellerSettings`, and private delivery records.
- Financial writes, verification webhooks, paid checkout, commission settlement and protected downloads are **not migrated** to V2. Production V1 remains the source of truth.
- Never stage against real customer data in a write-enabled mode; use emulator fixtures and compare anonymized read-only examples.

## Migration constraints

No collection rename, schema rewrite, Firebase project switch, Storage bucket replacement, or bulk role migration has been performed. Breaking a persisted field or Store slug must block cutover.