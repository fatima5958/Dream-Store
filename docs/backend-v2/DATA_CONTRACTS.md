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
- V2 now creates a store, reserves its slug, increments the campaign and records the UID claim in one Firestore transaction. Existing owner lookup preserves legacy IDs. Seller retries and edits do not add a founder claim. Deterministic repository tests cover contention; emulator concurrency coverage is present but has not run here.
- V2 exposes the authoritative counter through `GET /api/launch/creator-spots` and claims a spot only when a new Seller store is atomically created. Signup, Buyer onboarding, returning login and store updates do not consume spots.

## Finance and private customer records

- Preserve existing `orders`, `ledger`, `ledger_audit`, `commission_invoices`, `commission_payments`, `commission_payment_refs`, `commission_adjustments`, `subscriptions`, `sellerSettings`, and private delivery records.
- V2 retains V1 collection names and compatible document fields for `sellerSettings/{ownerId}`, `users/{ownerId}/private/settings`, `ledger/{orderNumber}`, `orders/{orderId}`, `checkout_idempotency/{sha256(buyerUid:key)}`, `payment_reference_claims/{sha256(seller:method:reference)}`, `ledger_audit/{auditId}`, and `commission_adjustments/{orderNumber}:refund`. Deterministic `commission_entries/{orderNumber}` records store commission in integer minor units. Admin invoice/payment settlement collections remain V1-only.
- V2 checkout recalculates price from current product/store documents and rechecks catalog, active store and receiving method in the transaction that creates the order. Buyer/Seller IDs come from the verified principal and persisted store owner. A repeated Buyer + idempotency key returns the same durable order.
- A submitted payment reference remains `Pending`; only the owning Seller may transition after confirming independent bank/wallet statement evidence. A reference alone never unlocks fulfillment. The saved amount, currency and 500-bps commission snapshot are validated before transition. Refunds require explicit actual-refund confirmation and a reference; they reverse commission and invalidate download tokens.
- Paid downloads use a shared server signing secret, order-scoped buyer/product/order/expiry/nonce claims, and authoritative order status. Consumption is transactional, limited to five downloads, rotates the nonce and returns original file bytes only to the authenticated Buyer. Rejection/refund invalidates prior tokens. Public product projections never expose private file references.
- Production V1 remains authoritative. Paid checkout is hard-blocked in production and disabled by default outside isolated staging. Automated payment gateways and production cutover remain disabled.
- Never stage against real customer data in a write-enabled mode; use emulator fixtures and compare anonymized read-only examples.

## Migration constraints

No collection rename, schema rewrite, Firebase project switch, Storage bucket replacement, or bulk role migration has been performed. Breaking a persisted field or Store slug must block cutover.

## Store records and slug reservations

- `stores/{existingStoreId}` retains persisted IDs and `ownerId`; new records use `store-{first 20 UID chars}`. `store_slugs/{slug}` contains store/owner IDs and timestamps. Slug changes reserve new and release old atomically.
- Store private settings stay persisted for compatibility, but never appear in public store projections. Visit events use a SHA-256 key; raw network addresses are not stored.

## Products and upload jobs

- `products/{productId}` retains owner/store/listing/price fields. Sales/download metrics stay server controlled through merges. Removed products set `deleted: true`.
- `products/{productId}/deliverables/main` stores the private path, owner, product, filename, MIME, byte count, Storage generation and timestamp. Public API projections omit it.
- `v2_upload_jobs/{uuid}` records owner/path/state. A pending job locks the product. Failed cleanup remains reconcilable. Replaced objects receive a one-day orphan job.
- Digital objects use `deliverables/{uid}/{productId}/{random}-{filename}`; cover objects use `stores/{uid}/public/{random}-{filename}`. Digital files do not get public download tokens.
- Upload limit remains 5 MiB. Accepted files: PDF, EPUB, ZIP, TXT, DOC, DOCX; covers: PNG, JPEG, WebP, GIF. Filename, extension, MIME and signature are validated.
