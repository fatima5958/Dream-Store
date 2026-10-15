# Backend V2 — Existing API Route Inventory

Derived from the **actual `server.ts` route declarations** on `main` at the start of the V2 implementation. These are 79 statically declared `/api` route registrations (including one `USE` middleware). Handlers registered dynamically require separate verification.

| Method | Existing route | Original line | Backend V2 status |
|---|---|---:|---|
| GET | `/api/health` | 3228 | Implemented in isolated V2 staging |
| GET | `/api/ready` | 3246 | Implemented in isolated V2 staging |
| GET | `/api/auth/oauth-diagnostics` | 3287 | Not migrated — V1 remains authoritative |
| USE | `/api/auth/email` | 3404 | Not migrated — V1 remains authoritative |
| POST | `/api/auth/email/signup` | 3416 | Not migrated — V1 remains authoritative |
| POST | `/api/auth/email/signin` | 3498 | Not migrated — V1 remains authoritative |
| POST | `/api/auth/email/reset-password` | 3553 | Not migrated — V1 remains authoritative |
| POST | `/api/auth/email/signout` | 3699 | Not migrated — V1 remains authoritative |
| GET | `/api/auth/email/migration-status` | 3712 | Not migrated — V1 remains authoritative |
| POST | `/api/auth/email/migrate` | 3728 | Not migrated — V1 remains authoritative |
| GET | `/api/auth/email/reset-audit` | 3745 | Not migrated — V1 remains authoritative |
| GET | `/api/payments/gateway-status` | 3804 | Not migrated — V1 remains authoritative |
| GET | `/api/payments/payoneer-readiness` | 3838 | Not migrated — V1 remains authoritative |
| GET | `/api/admin/verify-session` | 3894 | Implemented in isolated V2 staging |
| POST | `/api/admin/verify-session` | 3895 | Implemented in isolated V2 staging |
| POST | `/api/admin/bootstrap-super-admin` | 3900 | Not migrated — V1 remains authoritative |
| GET | `/api/users/profile` | 4477 | Implemented in isolated V2 staging |
| POST | `/api/users/profile` | 4478 | Implemented in isolated V2 staging |
| POST | `/api/users/role` | 4479 | Implemented in isolated V2 staging |
| GET | `/api/auth/onboarding` | 4480 | Implemented in isolated V2 staging |
| POST | `/api/auth/onboarding` | 4481 | Implemented in isolated V2 staging |
| GET | `/api/navigation/access` | 4482 | Implemented in isolated V2 staging |
| POST | `/api/navigation/access` | 4483 | Implemented in isolated V2 staging |
| GET | `/api/auth/verify-screen-access` | 4484 | Implemented in isolated V2 staging |
| GET | `/api/launch/creator-spots` | 4541 | Implemented in isolated V2 staging |
| GET | `/api/stores` | 4566 | Not migrated — V1 remains authoritative |
| POST | `/api/stores/visit` | 4585 | Not migrated — V1 remains authoritative |
| GET | `/api/stores/check-slug` | 4607 | Not migrated — V1 remains authoritative |
| GET | `/api/stores/by-slug/:slug` | 4668 | Not migrated — V1 remains authoritative |
| GET | `/api/stores/:slug` | 4669 | Not migrated — V1 remains authoritative |
| POST | `/api/stores/create` | 4932 | Not migrated — V1 remains authoritative |
| POST | `/api/stores/upsert` | 4933 | Not migrated — V1 remains authoritative |
| POST | `/api/stores/update` | 4936 | Not migrated — V1 remains authoritative |
| GET | `/api/payment-settings/:storeId` | 5353 | Not migrated — V1 remains authoritative |
| GET | `/api/payment-settings` | 5354 | Not migrated — V1 remains authoritative |
| POST | `/api/payment-settings/save` | 5355 | Not migrated — V1 remains authoritative |
| GET | `/api/seller-settings/:storeId` | 5356 | Not migrated — V1 remains authoritative |
| GET | `/api/seller-settings` | 5357 | Not migrated — V1 remains authoritative |
| POST | `/api/seller-settings` | 5358 | Not migrated — V1 remains authoritative |
| GET | `/api/checkout/payment-instructions/:storeId` | 5362 | Not migrated — V1 remains authoritative |
| POST | `/api/uploads/product` | 5435 | Not migrated — V1 remains authoritative |
| POST | `/api/products/upsert` | 5766 | Not migrated — V1 remains authoritative |
| POST | `/api/products/save` | 5767 | Not migrated — V1 remains authoritative |
| POST | `/api/products` | 5768 | Not migrated — V1 remains authoritative |
| POST | `/api/products/delete` | 5770 | Not migrated — V1 remains authoritative |
| POST | `/api/commission/calculate` | 5812 | Not migrated — V1 remains authoritative |
| POST | `/api/admin/commission-config` | 5851 | Not migrated — V1 remains authoritative |
| POST | `/api/admin/commission-rate` | 5852 | Not migrated — V1 remains authoritative |
| GET | `/api/ledger` | 5955 | Not migrated — V1 remains authoritative |
| GET | `/api/ledger/transactions` | 5956 | Not migrated — V1 remains authoritative |
| POST | `/api/checkout/validate-and-prepare` | 5959 | Not migrated — V1 remains authoritative |
| POST | `/api/orders/verify-payment` | 6436 | Not migrated — V1 remains authoritative |
| GET | `/api/orders/sync` | 6871 | Not migrated — V1 remains authoritative |
| GET | `/api/orders/list` | 6872 | Not migrated — V1 remains authoritative |
| GET | `/api/orders/:orderNumber/email-notification` | 6876 | Not migrated — V1 remains authoritative |
| POST | `/api/orders/refund` | 6918 | Not migrated — V1 remains authoritative |
| POST | `/api/ledger/commission-status` | 7014 | Not migrated — V1 remains authoritative |
| GET | `/api/commission/status` | 7154 | Not migrated — V1 remains authoritative |
| GET | `/api/commissions/invoices` | 7155 | Not migrated — V1 remains authoritative |
| GET | `/api/commission/admin-overview` | 7244 | Not migrated — V1 remains authoritative |
| GET | `/api/commission/admin/overview` | 7245 | Not migrated — V1 remains authoritative |
| POST | `/api/commission/admin/grant-pro` | 7351 | Not migrated — V1 remains authoritative |
| POST | `/api/admin/subscriptions/grant-pro` | 7352 | Not migrated — V1 remains authoritative |
| POST | `/api/admin/stores/status` | 7354 | Not migrated — V1 remains authoritative |
| POST | `/api/admin/stores/control` | 7379 | Not migrated — V1 remains authoritative |
| POST | `/api/commission/submit-payment` | 7478 | Not migrated — V1 remains authoritative |
| POST | `/api/commission/verify-payment` | 7731 | Not migrated — V1 remains authoritative |
| POST | `/api/admin/commission/verify-payment` | 7732 | Not migrated — V1 remains authoritative |
| POST | `/api/commissions/verify-payment` | 7733 | Not migrated — V1 remains authoritative |
| POST | `/api/commission/simulate-overdue` | 7736 | Not migrated — V1 remains authoritative |
| GET | `/api/entitlements/:sellerId` | 7792 | Not migrated — V1 remains authoritative |
| GET | `/api/subscriptions` | 7915 | Not migrated — V1 remains authoritative |
| GET | `/api/subscription/status` | 7916 | Not migrated — V1 remains authoritative |
| POST | `/api/subscriptions` | 7920 | Not migrated — V1 remains authoritative |
| POST | `/api/webhooks/:provider` | 7973 | Not migrated — V1 remains authoritative |
| POST | `/api/downloads/token` | 7977 | Not migrated — V1 remains authoritative |
| POST | `/api/delivery/verify-download` | 7991 | Not migrated — V1 remains authoritative |
| POST | `/api/test-suite/run` | 8274 | Not migrated — V1 remains authoritative |
| POST | `/api/gemini/chat` | 8532 | Not migrated — V1 remains authoritative |

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