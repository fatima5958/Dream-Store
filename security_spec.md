# DreamStore Multi-Tenant Security Specification (`security_spec.md`)

## 1. Data Invariants & Multi-Tenant Isolation Laws
1. **Strict Multi-Tenant Seller Isolation**: Every seller resource (`stores`, `products`, `orders`, `customers`, `sellerSettings`, `commissionInvoices`, `commissionPayments`, `analytics`, `downloads`, `subscriptions`) is bound to an immutable `ownerId` or `sellerId`. A seller (`request.auth.uid`) can NEVER read, list, create, update, delete, or export another seller's private data.
2. **Single Super Admin Invariant (Never Email Alone)**: Super Admin authority is NEVER granted based on email alone, frontend variables, or user-editable profile fields. In Firestore Rules, `isAdmin()` requires a verified user (`request.auth.token.email_verified == true`) whose UID exists in the read-only `/admins/{uid}` collection (`allow write: if false;` from clients — managed exclusively via Firebase Admin SDK server-side). On the backend, Super Admin requires matching the single configured `SUPER_ADMIN_UID`, server-managed custom claims (`role: 'super_admin'`, `superAdmin: true`), and recent reauthentication (`auth_time` within 15 minutes).
3. **Store Ownership & Public Visibility Invariant**: `/stores/{storeId}` must have `ownerId == request.auth.uid` on creation. Public visitors can only read stores where `status == 'Active'`. Suspended stores (`status == 'Suspended'`) are hidden from public reads. Sellers cannot mutate `status` or `plan`.
4. **PII & Payment / Payoneer Configuration Isolation**: `/sellerSettings/{sellerId}` and `/users/{userId}/private/{docId}` store seller email, JazzCash/Easypaisa/UPI/Bank details, and Payoneer receiving account/link configuration. Only `isOwner(sellerId)` or `isAdmin()` may read or write these documents (`allow list: if false;`).
5. **Product & Protected Deliverable Gate**: `/products/{productId}` can only be created if `/stores/$(incoming().storeId)` exists and its `ownerId == request.auth.uid`. Public visitors may read only `published == true` products. `/products/{productId}/deliverables/{deliverableId}` requires ownership, `isFree == true`, or an `'Active'` buyer entitlement in `/products/{productId}/entitlements/$(request.auth.uid)`.
6. **Order, Customer, Analytics & Download Isolation**:
   - Paid orders (`totalAmount > 0`) MUST start with `paymentStatus == 'Pending'` (never auto-unlocked by a payment/Payoneer reference alone).
   - `/customers/{customerId}` and `/analytics/{analyticsId}` are strictly restricted to the owning `sellerId` or `isAdmin()`.
   - `/downloads/{downloadId}` is restricted to the `buyerId`, `sellerId`, or `isAdmin()`.
   - `/subscriptions/{subscriptionId}` tracks Free vs. Pro entitlements; sellers cannot self-activate a `'Pro'` subscription without `isAdmin()`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Shadow Field Injection on Store**: Adding `"isSuperAdmin": true` to `/stores/{storeId}` — rejected by `hasOnly()`.
2. **Cross-Seller Store Ownership Spoofing**: Seller A creating or updating `/stores/{storeId}` with `ownerId: "seller_b_uid"` — rejected by `ownerId == request.auth.uid` and immutable `ownerId`.
3. **Unverified Email Spoof**: Attempting any write with `email_verified == false` — rejected by `isVerifiedUser()`.
4. **Cross-Seller Product Injection**: Seller A creating a product pointing to Seller B's `storeId` — rejected by `get(/databases/$(database)/documents/stores/$(incoming().storeId)).data.ownerId == request.auth.uid`.
5. **Paid / Payoneer Order Self-Marking as Paid**: Buyer creating an order with `totalAmount: 29`, `paymentMethod: 'payoneer'`, and `paymentStatus: 'Paid'` — rejected because paid orders must start as `'Pending'`.
6. **Unauthorized Deliverable Download**: Buyer attempting to `get` `/products/{productId}/deliverables/main` on a paid product without an active entitlement — rejected by master gate check.
7. **Cross-Seller Payment & Payoneer Settings Harvesting**: Seller A reading `/sellerSettings/seller_b_uid` or `/users/seller_b_uid/private/settings` — rejected by `isOwner()`.
8. **Cross-Seller Customer & Analytics Scraping**: Seller A listing `/customers` or `/analytics` without filtering by `resource.data.sellerId == request.auth.uid` — rejected by Query Enforcer.
9. **Self-Assigned Super Admin Escalation**: User attempting to write `/admins/{uid}` or self-approve `/commissionPayments/{paymentId}` — rejected by `allow write: if false` on `/admins` and `isAdmin()` on payment verification.
10. **Denial-of-Wallet 1MB String Injection**: Writing a 600KB `title` on `/products/{productId}` — rejected by `.size() <= 160`.
11. **ID Poisoning**: Creating `/stores/invalid$id!@#` — rejected by `isValidId()`.
12. **Terminal Order State Reversal**: Mutating an order whose `paymentStatus` is `'Refunded'` back to `'Paid'` as a non-admin — rejected by terminal state lock.
