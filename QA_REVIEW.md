# Dream Store QA review — 15 October 2026

This is a source-code and automated-test review, not a production certification. Live Firebase configuration, customer account migration and real payment flows have not been exercised.

## Corrections in this pass

| Workflow | Defect | Correction |
| --- | --- | --- |
| Store editor | UI changed immediately and swallowed persistence errors; API acknowledged background writes | Existing stores use the authenticated API; acknowledge database transactions before updating UI; show save errors |
| Store authorization | Cached ownership and optional client-controlled Pro enforcement | Fresh ownership read, transactional ownership recheck, verified email and suspension checks, mandatory API Pro check |
| Store settings | Invalid URL/rate accepted; full cached record could overwrite other fields or expose private fields | Validate slug and rate, write only requested public fields, retain server-managed plan/status |
| Checkout | Unsupported quantities/multiple products could reach payment instructions | Block unsupported or wrong-store carts before showing receiving details and submitting |
| Sign-in | Domain/provider setup errors suggested retries or redirects that cannot solve configuration failures | Specific domain/provider/rate-limit notices |
| CI | No manual run and narrowly hardcoded fix branch trigger | Manual QA runs, all fix branches and cancellation of superseded runs |

## Remaining release blockers and weaknesses

| Priority | Finding | Required follow-up |
| --- | --- | --- |
| High | Several administrative commission, moderation and Pro-grant paths still use fire-and-forget `syncFirestoreDoc`; in-memory financial state is not a reliable multi-instance source | Replace with validated durable transactions and add failure/restart coverage before paid production |
| High | Store creation checks slug availability before writing; direct Firestore clients can also create/change slugs | Introduce an atomic slug reservation shared by all writers, update/deploy rules, and test concurrent creation |
| High | Direct Firestore store editing remains permitted by existing rules and is not covered by API entitlement checks | Align deployed rules with the intended server-only editing/entitlement model and test migration compatibility |
| High | Real provider/domain settings, Admin credentials, named database access, bucket permissions and legacy account recovery are unverified | Follow DEPLOYMENT_CHECKLIST.md in staging, including old and newly created accounts |
| High | Paid payment, refund, commission settlement and restart reconciliation lack real end-to-end validation | Keep paid checkout off until verified; generic webhooks remain disabled |
| Medium | Custom visual-editor sections are not part of the durable store schema | Define and validate their schema before advertising persistent custom layouts |
| Medium | Production JavaScript bundle remains large | Split authenticated dashboards and chart dependencies; measure on mobile |

## Coverage and limits

Run `npm run lint`, `npm run build`, `npm run test:contracts`, and `npm run test:server`. CI additionally runs actual Firestore/Storage emulator rules tests and Chromium visitor/mobile/auth-recovery smoke tests. Server doubles cover failure handling but do not validate live Firebase identity verification. Browser smoke tests do not replace real seller/buyer staging transactions. No production data, rules, credentials or account migrations were changed in this pass.

## 15 October 2026 — release evidence update

The current main branch includes durable Admin-SDK commission submission and review transactions, server-only store mutations, atomic URL reservations, seller-authenticated URL availability checking and suspended-store recovery. The older table above is historical and should not be interpreted as the current status of every code path.

Automated unit/emulator/browser checks passing does **not** establish production readiness. Before activating real-money checkout, verify a staging deployment against the named Firebase database, actual production-like Firebase Auth identities, original file downloads, refunds, multi-instance/restart reconciliation, manual funds confirmation, legacy account migration, correct deployed rules, credentials, rollback and data backup. The staging preflight intentionally fails if paid checkout is enabled; it is not a paid-production certification tool.
