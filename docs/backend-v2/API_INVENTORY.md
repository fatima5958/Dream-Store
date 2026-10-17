# Backend V2 — Existing API Route Inventory

Status checked against `server/v2/app.ts` after Phase 6. V2 runs only in isolated staging; production remains on V1.

Derived from the **actual `server.ts` route declarations** on `main` at the start of the V2 implementation. These are 79 statically declared `/api` route registrations (including one `USE` middleware). Handlers registered dynamically require separate verification.

| Method | Existing route | Original line | Backend V2 status |
|---|---|---:|---|
| GET | `/api/health` | 3228 | Implemented in isolated V2 emulator staging |
| GET | `/api/ready` | 3246 | Implemented in isolated V2 emulator staging |
| GET | `/api/auth/oauth-diagnostics` | 3287 | Implemented — V1-compatible safe shape; external Firebase/Google registration is deliberately unqueried in isolated V2 |
| USE | `/api/auth/email` | 3404 | Intentionally unsupported in V2 — Firebase Web SDK is the only supported password/session mechanism; legacy server sessions are not migrated |
| POST | `/api/auth/email/signup` | 3416 | Replaced by existing Firebase `createUserWithEmailAndPassword` flow; API fallback is not enabled in V2 |
| POST | `/api/auth/email/signin` | 3498 | Replaced by existing Firebase `signInWithEmailAndPassword` flow; API fallback is not enabled in V2 |
| POST | `/api/auth/email/reset-password` | 3553 | Replaced by Firebase `sendPasswordResetEmail`; legacy token reset is disabled in V2 |
| POST | `/api/auth/email/signout` | 3699 | Replaced by Firebase client `signOut`; legacy server sessions are unsupported |
| GET | `/api/auth/email/migration-status` | 3712 | Intentionally disabled — no parallel password database or migration |
| POST | `/api/auth/email/migrate` | 3728 | Intentionally disabled — existing Firebase Auth identities remain authoritative |
| GET | `/api/auth/email/reset-audit` | 3745 | Intentionally disabled — V2 does not issue legacy reset tokens |
| GET | `/api/payments/gateway-status` | 3804 | Implemented — reports disabled gateways without inspecting or exposing credentials |
| GET | `/api/payments/payoneer-readiness` | 3838 | Implemented — manual settlement only; API processing is disabled in V2 |
| GET | `/api/admin/verify-session` | 3894 | Implemented in isolated V2 emulator staging |
| POST | `/api/admin/verify-session` | 3895 | Implemented in isolated V2 emulator staging |
| POST | `/api/admin/bootstrap-super-admin` | 3900 | Intentionally disabled — Admin claims are provisioned through trusted Firebase administration, never public bootstrap |
| GET | `/api/users/profile` | 4477 | Implemented in isolated V2 emulator staging |
| POST | `/api/users/profile` | 4478 | Implemented in isolated V2 emulator staging |
| POST | `/api/users/role` | 4479 | Implemented in isolated V2 emulator staging |
| GET | `/api/auth/onboarding` | 4480 | Implemented in isolated V2 emulator staging |
| POST | `/api/auth/onboarding` | 4481 | Implemented in isolated V2 emulator staging |
| GET | `/api/navigation/access` | 4482 | Implemented in isolated V2 emulator staging |
| POST | `/api/navigation/access` | 4483 | Implemented in isolated V2 emulator staging |
| GET | `/api/auth/verify-screen-access` | 4484 | Implemented in isolated V2 emulator staging |
| GET | `/api/launch/creator-spots` | 4541 | Implemented in isolated V2 emulator staging |
| GET | `/api/stores` | 4566 | Implemented in isolated V2 emulator staging (active public directory, positive field allowlist, bounded 100 records) |
| POST | `/api/stores/visit` | 4585 | Implemented — hashed deduped event |
| GET | `/api/stores/check-slug` | 4607 | Implemented — slug reservations |
| GET | `/api/stores/by-slug/:slug` | 4668 | Implemented — public allowlist + visible products |
| GET | `/api/stores/:slug` | 4669 | Implemented — public allowlist + visible products |
| POST | `/api/stores/create` | 4932 | Implemented — atomic owner/slug/campaign |
| POST | `/api/stores/upsert` | 4933 | Implemented — idempotent create alias |
| POST | `/api/stores/update` | 4936 | Implemented — owner-only active store |
| GET | `/api/payment-settings/:storeId` | 5353 | Implemented — authenticated verified owner only |
| GET | `/api/payment-settings` | 5354 | Implemented — authenticated verified owner only |
| POST | `/api/payment-settings/save` | 5355 | Implemented — owner-only manual settings; automated gateways disabled |
| GET | `/api/seller-settings/:storeId` | 5356 | Implemented — compatible owner-only alias |
| GET | `/api/seller-settings` | 5357 | Implemented — compatible owner-only alias |
| POST | `/api/seller-settings` | 5358 | Implemented — compatible owner-only alias |
| GET | `/api/checkout/payment-instructions/:storeId` | 5362 | Implemented — sanitized public Buyer instructions |
| POST | `/api/uploads/product` | 5435 | Implemented — private immutable upload |
| POST | `/api/products/upsert` | 5766 | Implemented — validated owner catalog |
| POST | `/api/products/save` | 5767 | Implemented — alias |
| POST | `/api/products` | 5768 | Implemented — alias |
| POST | `/api/products/delete` | 5770 | Implemented — owner-only tombstone |
| POST | `/api/commission/calculate` | 5812 | Implemented — supported manual methods, integer-minor 5% calculation |
| POST | `/api/admin/commission-config` | 5851 | Implemented — verified Super Admin only; fixed 500 bps, rejects rate changes |
| POST | `/api/admin/commission-rate` | 5852 | Implemented — compatible alias; same fixed 500 bps policy |
| GET | `/api/ledger` | 5955 | Implemented — Seller's own ledger or scoped Super Admin query; bounded cursor pages |
| GET | `/api/ledger/transactions` | 5956 | Implemented — compatible alias for the same scoped ledger contract |
| POST | `/api/checkout/validate-and-prepare` | 5959 | Implemented — authoritative Firestore pricing and durable idempotency; paid flow isolated and opt-in |
| POST | `/api/orders/verify-payment` | 6436 | Implemented — owning Seller only; amount/currency/commission snapshot checks |
| GET | `/api/orders/sync` | 6871 | Implemented — Buyer/Seller identity-filtered |
| GET | `/api/orders/list` | 6872 | Implemented — Buyer/Seller identity-filtered |
| GET | `/api/orders/:orderNumber/email-notification` | 6876 | Implemented — authorized status only; private email/token redacted; no send is triggered |
| POST | `/api/orders/refund` | 6918 | Implemented — Seller-only evidence-confirmed refund, commission reversal, download revocation |
| POST | `/api/ledger/commission-status` | 7014 | Implemented — Seller submits one reasoned dispute; cannot change settlement state |
| GET | `/api/commission/status` | 7154 | Implemented — Seller own summary; Admin may request a specific seller |
| GET | `/api/commissions/invoices` | 7155 | Implemented — compatible Seller summary alias |
| POST | `/api/commission/invoices/issue` | V2 only | Implemented — idempotent 5-verified-sale invoice issuance for the authenticated Seller |
| GET | `/api/commission/admin-overview` | 7244 | Implemented — Admin-only invoice/payment/adjustment data; traffic/store metrics omitted until migrated |
| GET | `/api/commission/admin/overview` | 7245 | Implemented — compatible Admin financial overview alias |
| GET | `/api/commission/admin/disputes` | V2 only | Implemented — verified Super Admin only; bounded, optional Seller-scoped list |
| POST | `/api/commission/admin/disputes/resolve` | V2 only | Implemented — approve/reject with required explanation; transactional and audited |
| POST | `/api/commission/admin/grant-pro` | 7351 | Implemented — verified Super Admin; Free/Pro only and transactionally persisted |
| POST | `/api/admin/subscriptions/grant-pro` | 7352 | Implemented — compatible Super Admin alias |
| POST | `/api/admin/stores/status` | 7354 | Implemented — verified Super Admin; activate/pending/suspend with audit |
| POST | `/api/admin/stores/control` | 7379 | Implemented — safe controls/metadata/Free-Pro; bulk actions rejected |
| POST | `/api/commission/submit-payment` | 7478 | Implemented — owning Seller only; unique reference, integer amount, auditable Seller-submitted evidence |
| POST | `/api/commission/verify-payment` | 7731 | Implemented — verified Super Admin only; independent cleared-funds attestation and idempotent transition |
| POST | `/api/admin/commission/verify-payment` | 7732 | Implemented — compatible alias |
| POST | `/api/commissions/verify-payment` | 7733 | Implemented — compatible alias |
| POST | `/api/commission/simulate-overdue` | 7736 | Intentionally disabled — financial date simulation would mutate V1-style balances; returns truthful 501 |
| GET | `/api/entitlements/:sellerId` | 7792 | Implemented — Seller self-only or verified Super Admin; Firestore-derived plan |
| GET | `/api/subscriptions` | 7915 | Implemented — own records or scoped Super Admin query |
| GET | `/api/subscription/status` | 7916 | Implemented — compatible alias |
| POST | `/api/subscriptions` | 7920 | Implemented — verified Seller Pro waitlist only; cannot activate or charge |
| POST | `/api/webhooks/:provider` | 7973 | Implemented as disabled — always returns truthful 503; no gateway webhook is active |
| POST | `/api/downloads/token` | 7977 | Implemented — Buyer-owned paid order only |
| POST | `/api/delivery/verify-download` | 7991 | Implemented — signed scoped expiring one-use access to private Storage bytes |
| POST | `/api/test-suite/run` | 8274 | Intentionally disabled — use isolated automated tests; runtime route would expose internal diagnostics |
| POST | `/api/gemini/chat` | 8532 | Implemented — guest-compatible bounded local fallback; external Gemini use requires explicit staging flag and server key |

## Frontend API consumers inspected

- `src/App.tsx`: `/api/checkout/payment-instructions/`, `/api/stores`, `/api/stores/by-slug/`, `/api/payments/gateway-status`, `/api/admin/verify-session`, `/api/users/profile`, `/api/seller-settings`, `/api/navigation/access`, `/api/orders/list`, `/api/stores/create`, `/api/stores/update`, `/api/products/upsert`, `/api/products/delete`, `/api/checkout/validate-and-prepare`, `/api/orders/refund`, `/api/orders/verify-payment`, `/api/ledger/commission-status`, `/api/delivery/verify-download`, `/api/stores/visit`
- `src/lib/firebase.ts`: `/api/auth/email/signup`, `/api/auth/email/signin`, `/api/auth/email/reset-password`, `/api/auth/email/signout`
- `src/components/CandylandAuthModal.tsx`: `/api/auth/oauth-diagnostics`
- `src/components/screens/StoreSetupWizard.tsx`: `/api/launch/creator-spots`, `/api/stores/check-slug`
- `src/components/screens/SuperAdminDashboard.tsx`: `/api/commission/admin/overview`, `/api/admin/stores/status`, `/api/commission/admin/grant-pro`, `/api/admin/stores/control`, `/api/admin/commission-config`, `/api/admin/commission/verify-payment`
- `src/components/screens/StoreOwnerDashboard.tsx`: `/api/commission/status`, `/api/commission/submit-payment`, `/api/uploads/product`
- `src/components/GeminiChatWidget.tsx`: `/api/gemini/chat`

## Phase 5 financial compatibility and limitations

- Invoice records use the V1 `commission_invoices`, `commission_payments`, `commission_payment_refs`, `commission_adjustments` and `ledger_audit` collections and field names. Five verified, unbilled paid sales in one currency issue a deterministic seven-day invoice. Reads do not issue invoices; Seller payment verification invokes issuance, with a Seller-only retry endpoint.
- Commission payment evidence is a seller-declared manual reference and note. The Admin must explicitly attest that cleared funds were checked externally. V2 does not independently verify a bank, wallet or gateway statement.
- Refunds create compatible adjustment records and reduce unpaid invoice balances. Reversal of already settled commission is recorded as a positive invoice adjustment; no real transfer or automatic credit occurs.
- Disputes use durable `pending → approved|rejected` records. Pending disputes block settlement submission/review and refunds for the affected invoice/order. Approval adjusts only a wholly unpaid invoice. For any settled portion, invoice totals remain untouched and the audit adjustment requires human reconciliation; no credit or refund is issued.
- Store moderation and Pro changes require the configured verified Super Admin. Suspension retains V1's `Pending` store status and adds `adminControlStatus: suspended`; Seller edits cannot reactivate it. Pro grants/revokes update the Store plan and deterministic `subscriptions/sub-{storeId}` row transactionally. Seller self-service only joins the Pro waitlist.
- Ledger endpoints return at most 200 scoped entries per page. Order notification lookup never sends email and returns no addresses or tokens. Payoneer readiness always reports manual settlement in V2.
- `/api/commission/admin-overview` currently returns financial records only. Store roster and visit/conversion metrics are omitted rather than fabricated.
- Unsupported: legacy email/password API fallback and migration/reset token routes, Admin bootstrap, runtime test-suite, commission overdue simulation and other unlisted V1 APIs return 501 on isolated V2. They remain on V1 in production. Automated payment webhooks return 503.
- Firebase email signup/signin/password reset use the existing Firebase Web SDK; V2 will not create a parallel password database. OAuth diagnostics expose only an unavailable/unverified result in isolated V2. Confirm Firebase authorized domains and Google OAuth redirect registrations in the dedicated staging project.
- Legacy Buyer restoration is implemented as a read-only profile projection only when a verified Firebase identity has an exact UID match in `ledger.buyerId`; email matching alone never restores ownership. Existing role documents remain authoritative. Seller restoration still requires an owned Store.
- Gemini chat has a bounded local fallback. External API generation is disabled unless `DREAMSTORE_V2_GEMINI_ENABLED=true` and a server-side `GEMINI_API_KEY` are both configured; per-IP request and process concurrency limits are applied. No credential is returned. This process-local limiter is not a production edge control.
- Blocked pending provider contracts: live Firebase/Google OAuth verification in V2, legacy password migration/reset delivery, live gateway callbacks, order email sending, and real Gemini billing/quota controls. No provider delivery or identity migration is fabricated in V2.

## Compatibility note

Backend V2 includes only the explicitly implemented route subset above. Other unsupported `/api/*` routes return HTTP 501 on isolated V2; disabled webhooks return 503. The production V1 backend continues to serve them unchanged. **Do not route production frontend traffic to V2 yet.**


## Store + catalog phase

Implemented under `server/v2/modules/{stores,products,uploads,policy}.ts` and wired through typed repositories. Seller writes verify the Firebase bearer, verified email, persisted Seller role, store ownership and active status. Store create uses one Firestore transaction for owner uniqueness, legacy/canonical IDs, slug reservation, campaign count and first-100 claim. Existing owner retries do not overwrite a newer configuration or consume a claim. Public store and product responses use positive projections; file paths/generations are private.

Uploads accept PDF, EPUB, ZIP, TXT, DOC, DOCX plus PNG/JPEG/WebP/GIF covers. The existing 5 MiB limit remains. Upload uses random immutable Storage object names, verifies stored metadata and commits Firestore references before reporting success. Failed writes attempt cleanup and retain durable cleanup jobs if cleanup fails. Old replacement files are queued for a one-day cleanup. No background scheduler is enabled; cleanup is an explicit guarded staging command.

`GET /api/products?storeId=...` returns drafts to the verified store owner and only published `Available` products to guests. Storefront response stays `{ store, products }`; directory response stays `{ stores }`. Visits do not reveal aggregate metrics.

V2 implements owner payment settings, sanitized manual checkout instructions, isolated server-priced checkout/order persistence, Seller verification/refunds, 5% commission entries, invoices/settlements, dispute resolution, Admin store management, Pro entitlements, scoped ledger reads, protected downloads and status-only email/Payoneer contracts. Paid checkout remains restricted to explicit isolated-staging opt-in and hard-blocked in production. No production traffic or payment activity has been switched.
## Phase 11 storage compatibility

No new public endpoint is required for Supabase. Existing product/cover upload, product publishing/listing, `/api/assets/covers/:ownerId/:fileName`, `/api/downloads/token` and `/api/delivery/verify-download` use the selected private staging provider through the existing repositories. Firebase Auth, Seller ownership and Buyer entitlement boundaries are unchanged. Cloud staging selection removes the Firebase Storage bucket requirement only; production, automatic gateways/webhooks and paid checkout remain disabled. See `STORAGE_CONFIGURATION.md` for configuration and evidence limits.
