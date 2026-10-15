# Backend V2 — Existing API Route Inventory

Status checked against `server/v2/app.ts` after the Store + Digital Products phase. V2 runs only in isolated staging; production remains on V1.

Derived from the **actual `server.ts` route declarations** on `main` at the start of the V2 implementation. These are 79 statically declared `/api` route registrations (including one `USE` middleware). Handlers registered dynamically require separate verification.

| Method | Existing route | Original line | Backend V2 status |
|---|---|---:|---|
| GET | `/api/health` | 3228 | Implemented in isolated V2 emulator staging |
| GET | `/api/ready` | 3246 | Implemented in isolated V2 emulator staging |
| GET | `/api/auth/oauth-diagnostics` | 3287 | Pending — V1 remains authoritative |
| USE | `/api/auth/email` | 3404 | Pending — V1 remains authoritative |
| POST | `/api/auth/email/signup` | 3416 | Pending — V1 remains authoritative |
| POST | `/api/auth/email/signin` | 3498 | Pending — V1 remains authoritative |
| POST | `/api/auth/email/reset-password` | 3553 | Pending — V1 remains authoritative |
| POST | `/api/auth/email/signout` | 3699 | Pending — V1 remains authoritative |
| GET | `/api/auth/email/migration-status` | 3712 | Pending — V1 remains authoritative |
| POST | `/api/auth/email/migrate` | 3728 | Pending — V1 remains authoritative |
| GET | `/api/auth/email/reset-audit` | 3745 | Pending — V1 remains authoritative |
| GET | `/api/payments/gateway-status` | 3804 | Pending — V1 remains authoritative |
| GET | `/api/payments/payoneer-readiness` | 3838 | Pending — V1 remains authoritative |
| GET | `/api/admin/verify-session` | 3894 | Implemented in isolated V2 emulator staging |
| POST | `/api/admin/verify-session` | 3895 | Implemented in isolated V2 emulator staging |
| POST | `/api/admin/bootstrap-super-admin` | 3900 | Pending — V1 remains authoritative |
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
| POST | `/api/admin/commission-config` | 5851 | Pending — V1 remains authoritative |
| POST | `/api/admin/commission-rate` | 5852 | Pending — V1 remains authoritative |
| GET | `/api/ledger` | 5955 | Pending — V1 remains authoritative |
| GET | `/api/ledger/transactions` | 5956 | Pending — V1 remains authoritative |
| POST | `/api/checkout/validate-and-prepare` | 5959 | Implemented — authoritative Firestore pricing and durable idempotency; paid flow isolated and opt-in |
| POST | `/api/orders/verify-payment` | 6436 | Implemented — owning Seller only; amount/currency/commission snapshot checks |
| GET | `/api/orders/sync` | 6871 | Implemented — Buyer/Seller identity-filtered |
| GET | `/api/orders/list` | 6872 | Implemented — Buyer/Seller identity-filtered |
| GET | `/api/orders/:orderNumber/email-notification` | 6876 | Pending — V1 remains authoritative |
| POST | `/api/orders/refund` | 6918 | Implemented — Seller-only evidence-confirmed refund, commission reversal, download revocation |
| POST | `/api/ledger/commission-status` | 7014 | Pending — V1 remains authoritative |
| GET | `/api/commission/status` | 7154 | Pending — V1 remains authoritative |
| GET | `/api/commissions/invoices` | 7155 | Pending — V1 remains authoritative |
| GET | `/api/commission/admin-overview` | 7244 | Pending — V1 remains authoritative |
| GET | `/api/commission/admin/overview` | 7245 | Pending — V1 remains authoritative |
| POST | `/api/commission/admin/grant-pro` | 7351 | Pending — V1 remains authoritative |
| POST | `/api/admin/subscriptions/grant-pro` | 7352 | Pending — V1 remains authoritative |
| POST | `/api/admin/stores/status` | 7354 | Pending — V1 remains authoritative |
| POST | `/api/admin/stores/control` | 7379 | Pending — V1 remains authoritative |
| POST | `/api/commission/submit-payment` | 7478 | Pending — V1 remains authoritative |
| POST | `/api/commission/verify-payment` | 7731 | Pending — V1 remains authoritative |
| POST | `/api/admin/commission/verify-payment` | 7732 | Pending — V1 remains authoritative |
| POST | `/api/commissions/verify-payment` | 7733 | Pending — V1 remains authoritative |
| POST | `/api/commission/simulate-overdue` | 7736 | Pending — V1 remains authoritative |
| GET | `/api/entitlements/:sellerId` | 7792 | Pending — V1 remains authoritative |
| GET | `/api/subscriptions` | 7915 | Pending — V1 remains authoritative |
| GET | `/api/subscription/status` | 7916 | Pending — V1 remains authoritative |
| POST | `/api/subscriptions` | 7920 | Pending — V1 remains authoritative |
| POST | `/api/webhooks/:provider` | 7973 | Pending — V1 remains authoritative |
| POST | `/api/downloads/token` | 7977 | Implemented — Buyer-owned paid order only |
| POST | `/api/delivery/verify-download` | 7991 | Implemented — signed scoped expiring one-use access to private Storage bytes |
| POST | `/api/test-suite/run` | 8274 | Pending — V1 remains authoritative |
| POST | `/api/gemini/chat` | 8532 | Pending — V1 remains authoritative |

## Frontend API consumers inspected

- `src/App.tsx`: `/api/checkout/payment-instructions/`, `/api/stores`, `/api/stores/by-slug/`, `/api/payments/gateway-status`, `/api/admin/verify-session`, `/api/users/profile`, `/api/seller-settings`, `/api/navigation/access`, `/api/orders/list`, `/api/stores/create`, `/api/stores/update`, `/api/products/upsert`, `/api/products/delete`, `/api/checkout/validate-and-prepare`, `/api/orders/refund`, `/api/orders/verify-payment`, `/api/ledger/commission-status`, `/api/delivery/verify-download`, `/api/stores/visit`
- `src/lib/firebase.ts`: `/api/auth/email/signup`, `/api/auth/email/signin`, `/api/auth/email/reset-password`, `/api/auth/email/signout`
- `src/components/CandylandAuthModal.tsx`: `/api/auth/oauth-diagnostics`
- `src/components/screens/StoreSetupWizard.tsx`: `/api/launch/creator-spots`, `/api/stores/check-slug`
- `src/components/screens/SuperAdminDashboard.tsx`: `/api/commission/admin/overview`, `/api/admin/stores/status`, `/api/commission/admin/grant-pro`, `/api/admin/stores/control`, `/api/admin/commission-config`, `/api/admin/commission/verify-payment`
- `src/components/screens/StoreOwnerDashboard.tsx`: `/api/commission/status`, `/api/commission/submit-payment`, `/api/uploads/product`
- `src/components/GeminiChatWidget.tsx`: `/api/gemini/chat`

## Compatibility note

Backend V2 currently includes only the explicitly implemented route subset. All other `/api/*` routes return HTTP 501 on the isolated V2 staging process; the production V1 backend continues to serve them unchanged. **Do not route production frontend traffic to V2 yet.**


## Store + catalog phase

Implemented under `server/v2/modules/{stores,products,uploads,policy}.ts` and wired through typed repositories. Seller writes verify the Firebase bearer, verified email, persisted Seller role, store ownership and active status. Store create uses one Firestore transaction for owner uniqueness, legacy/canonical IDs, slug reservation, campaign count and first-100 claim. Existing owner retries do not overwrite a newer configuration or consume a claim. Public store and product responses use positive projections; file paths/generations are private.

Uploads accept PDF, EPUB, ZIP, TXT, DOC, DOCX plus PNG/JPEG/WebP/GIF covers. The existing 5 MiB limit remains. Upload uses random immutable Storage object names, verifies stored metadata and commits Firestore references before reporting success. Failed writes attempt cleanup and retain durable cleanup jobs if cleanup fails. Old replacement files are queued for a one-day cleanup. No background scheduler is enabled; cleanup is an explicit guarded staging command.

`GET /api/products?storeId=...` returns drafts to the verified store owner and only published `Available` products to guests. Storefront response stays `{ store, products }`; directory response stays `{ stores }`. Visits do not reveal aggregate metrics.

V2 now implements owner payment settings, sanitized manual checkout instructions, isolated server-priced checkout/order persistence, Seller verification/refunds, 5% commission entries/reversal adjustments and protected downloads. Commission invoice/settlement and Admin financial operations, gateway status/webhooks, email notifications, AI and email/password endpoints remain pending and return 501. Paid checkout is rejected in production and no production traffic or payment activity has been switched.
