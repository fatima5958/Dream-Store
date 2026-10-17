# V2 staging storage configuration

## Scope and identity

V2 supports Firebase Storage (existing emulator/cloud path) and explicitly selected **private Supabase Storage in Cloud Run staging only**. Firebase Authentication remains the sole identity authority; the named Firestore database remains authoritative for owners, products, upload jobs, orders, entitlements and download nonces. No Supabase Auth, Postgres application-data migration, frontend SDK, public policies or production provider switch is introduced.

`storage/contracts.ts` defines only the object operations V2 already uses. The Firebase Bucket satisfies that interface. `storage/supabase.ts` implements it with the official `@supabase/storage-js` SDK. The upload repository's historical function name is retained for compatibility; its ownership checks, transaction reservations and completion compensation apply to either provider. Covers share `storage/covers.ts`. Product publish, fulfillment and cleanup receive the selected bucket through dependency injection.

### Provider configuration

Set the existing activation, project ID/number allowlists, named database allowlist, Cloud Run service/revision/account allowlists, Super Admin UID and signing-secret configuration from `STAGING_SETUP.md`. These checks run before accessing either storage provider. Production project `dulcet-trees-qk6n5` / `582009353900` remains rejected.

| Variable | Supabase staging value |
| --- | --- |
| `DREAMSTORE_V2_STAGING` | `1` |
| `DREAMSTORE_V2_MODE` | `cloud-staging` |
| `DREAMSTORE_V2_STORAGE_PROVIDER` | `supabase` (default remains `firebase`) |
| `DREAMSTORE_V2_SUPABASE_URL` | Exact `https://<20-character-project-ref>.supabase.co` origin; no slash suffix, path, credentials, port, query or fragment |
| `DREAMSTORE_V2_SUPABASE_ALLOWED_PROJECT_REFS` | Explicit reviewed staging project ref allowlist |
| `DREAMSTORE_V2_SUPABASE_BUCKET` | Existing private `dreamstore-v2-staging-files` |
| `DREAMSTORE_V2_SUPABASE_ALLOWED_BUCKETS` | Exact reviewed staging bucket allowlist |
| `DREAMSTORE_V2_SUPABASE_SECRET_NAME` | Dedicated Secret Manager secret ID containing `staging` |
| `DREAMSTORE_V2_SUPABASE_ALLOWED_SECRET_NAMES` | Exact credential-secret allowlist |

Supabase mode **omits** `DREAMSTORE_V2_CLOUD_STAGING_STORAGE_BUCKET` and `DREAMSTORE_V2_CLOUD_STAGING_ALLOWED_STORAGE_BUCKETS`. Mixed unused Firebase bucket settings fail configuration. Firebase Storage is not initialized or probed in this mode. `firebase-applet-config.json` remains the production identifier denylist, not a Supabase target.

The Cloud Run identity reads the separate Supabase credential secret only after project ID, numeric project identity and service-account metadata match. Its credential-secret ID must differ from the download/invoice signing-secret ID. Prefer a modern `sb_secret_...` key; a legacy service_role JWT is accepted only when its role/ref/expiry match staging, and Supabase authenticates it on each request. Publishable/anon keys are refused. Inline service credentials in `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` or `DREAMSTORE_V2_SUPABASE_SECRET_KEY` are refused in cloud mode. Never use `VITE_` for server credentials. No credential value is required in chat or committed files.

Retain the existing no-emulator-variable, no-inline-signing-secret and no-credential-file rules. Emulator mode refuses selection of an external storage provider; it continues requiring all three loopback Firebase emulators and a `demo-*` project. Choosing Supabase does not introduce a less protected runtime or a production mode.

## Private bucket and operations

Bucket creation/policy editing is deliberately absent from application startup. The owner must independently verify the bucket belongs to the synthetic staging project, is PRIVATE, and has no broad `anon` / `authenticated` Storage policies. A dashboard `main / PRODUCTION` label is a Supabase environment label, not authorization to store real customer data.

Startup/readiness and every object operation verify the selected bucket exists, reports `public: false`, supports the app's configured upload capacity and (if restricted) MIME types. A paused/unavailable project, invalid credential, public bucket or incompatible limit fails closed. Readiness returns only `ready` / `not_ready`; errors contain no provider details or secret values. The bucket metadata API does not audit all Postgres RLS policies: the zero-policy dashboard check and live anonymous-access tests remain separate release gates.

| Operation | Behavior |
| --- | --- |
| Product upload | Verified Seller and active owned store; reserved product ID; UUID object name; `deliverables/<FirebaseUID>/<productId>/<uuid>-<name>`; `upsert: false`; binary signature/MIME/size checks; acknowledged object-info read before Firestore completion |
| Cover upload | Same ownership controls; `stores/<FirebaseUID>/public/<uuid>-<name>` is a logical namespace **inside the private bucket**, not public bucket access |
| Publishing | Existing owned deliverable, correct provider/bucket binding and immutable version must match; client file paths never establish ownership |
| Cover retrieval | Existing `/api/assets/covers/:ownerId/:fileName` serves validated image bytes with sandbox/CSP/nosniff; cannot resolve a deliverable path or return a PDF |
| Product delivery | Existing Firebase-authenticated scoped HMAC token + authoritative paid/free entitlement, Buyer UID, expiry, rotating nonce, refund/revocation and download limit checks; streams private bytes through backend, then preserves existing JSON data-URL response |
| Replace/cleanup | New UUID path; durable old-file cleanup job, provider/bucket binding, owner namespace validation; create-conflict compensation never deletes a pre-existing object |

The adapter validates every path and rejects traversal, encoded traversal, foreign URL paths, extra segments and non-owner namespaces. Requests use only the allowlisted Supabase origin, reject redirects and apply timeouts. Downloads enforce metadata size, a bounded 5 MiB stream, immutable version consistency, MIME and signature validation. No Supabase public/signed URLs are generated. The privileged key bypasses RLS, so all user authorization is enforced by the existing backend before storage access; browser clients get no key and need no Supabase user/policy.

Supported existing formats remain PDF, EPUB, ZIP, TXT, DOCX, legacy DOC and PNG/JPG/JPEG/WEBP/GIF covers. V1/frontend/HTTP/rules capacity stays **5 MiB**. The owner's Supabase global 50 MB limit is a provider ceiling, not a new DreamStore upload contract. Raising the app limit requires coordinated frontend/HTTP/memory/abuse testing in a separate change.

## Durable references and recovery

Existing `storage://<objectPath>` private references remain internal to Firestore. New Supabase deliverables and `v2_upload_jobs` additionally record `storageProvider: supabase`, exact `storageBucket` and `storageGeneration` (Supabase object version). Public product projections never include these fields. Untagged legacy references mean Firebase; provider/bucket mismatches fail closed and never trigger fallback or silent migration.

A successful upload requires both acknowledged Storage completion and Firestore completion. Failed writes delete only the new object when possible. If deletion/Firestore recovery fails or the process stops, the persisted pending job and lock remain for reconciliation. Run `npm run cleanup:v2:uploads` only inside the approved staging runtime; cloud mode repeats all startup/identity/selected-provider guards, and emulator mode retains the demo/loopback guards. It processes at most 100 expired jobs per state. Do not clear jobs or locks manually. Upload/cleanup atomicity across two services is compensated, not a distributed atomic commit. Live provider outage/restart cleanup must still be rehearsed.

Already fulfilled purchases retain the existing entitlement after catalog unpublish/archive; new checkout and public discovery are blocked. Refund/revocation still blocks fulfillment. This is existing financial behavior, not an expansion of download rights.

## Validation and setup evidence

`npm run test:v2` includes SDK HTTP-double tests for configuration, credential boundaries, private bucket readiness, object operations, failure compensation, ownership, paid/free entitlement, covers and persistence. `npm run test:v2:emulator` also combines actual local Firebase Auth/named Firestore with the official Supabase SDK and a controlled HTTP double. These do **not** validate real Supabase RLS, cloud credentials, IAM, Google OAuth, the named cloud database or deployment.

Owner setup, after code review (no secret screenshots):

1. Supabase Dashboard → intended staging project → **Storage → Files → dreamstore-v2-staging-files**. Verify PRIVATE and the bucket size/MIME configuration; keep policies at zero. Capture only bucket name/privacy/limit/policy count.
2. Project **Connect** dialog or **Settings → Data API**: record the non-secret project URL/ref. Confirm it is a dedicated staging project before placing its ref/bucket in allowlists.
3. **Settings → API Keys**: use a server secret key only through the approved secret store, never browser code or chat. The existing Cloud Run path requires Secret Manager; do not provision billable GCP resources without approval. This milestone does not deploy anything. See `FREE_HOSTING_REVIEW.md` for the remaining free-host runtime work.

Sources (checked 2026-10-17): [private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [RLS/service credentials](https://supabase.com/docs/guides/storage/security/access-control), [API keys](https://supabase.com/docs/guides/getting-started/api-keys), [file limits](https://supabase.com/docs/guides/storage/uploads/file-limits), [SDK upload](https://supabase.com/docs/reference/javascript/file-buckets-upload), [object info](https://supabase.com/docs/reference/javascript/storage-from-info).
