# V2 production bootstrap — not a production cutover

The independent `npm run start:backend-v2:production` command adds a real-provider
API bootstrap without weakening emulator, Cloud Run staging or Render staging
guards. Existing Dockerfiles and startup commands still select their existing
backends. The public frontend has not been switched by this change.

Required server-only configuration:

| Setting | Required value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DREAMSTORE_V2_MODE` | `production` |
| `DREAMSTORE_V2_PRODUCTION_ENABLED` | `true` |
| `DREAMSTORE_V2_PRODUCTION_PROJECT_ID` | Exact project ID in `firebase-applet-config.json` |
| `DREAMSTORE_V2_PRODUCTION_DATABASE_ID` | Exact named database in that same file |
| `SUPER_ADMIN_UID` | Owner UID; signed `role=super_admin` and `superAdmin=true` claims are also required |
| `SERVER_SIGNING_SECRET` | Existing durable production signing secret, at least 40 characters |
| `DREAMSTORE_V2_STORAGE_PROVIDER` | Explicit `firebase` or `supabase` |
| `DREAMSTORE_V2_PRODUCTION_WRITES_ENABLED` | Leave unset for read-only verification; `true` enables repository mutations |

Mount a dedicated production Firebase service-account JSON file at
`/etc/secrets/dreamstore-v2-production-firebase.json`. Its project and service-account
email must match the production project. Do not copy the staging key or signing
secret. No credentials belong in the repository or browser bundle.

For Firebase Storage set `DREAMSTORE_V2_PRODUCTION_STORAGE_BUCKET` to the exact
configured bucket. Startup requires uniform bucket-level IAM and enforced public
access prevention. For Supabase set all four server-only settings:
`DREAMSTORE_V2_PRODUCTION_SUPABASE_URL`,
`DREAMSTORE_V2_PRODUCTION_SUPABASE_PROJECT_REF`,
`DREAMSTORE_V2_PRODUCTION_SUPABASE_BUCKET`, and
`DREAMSTORE_V2_PRODUCTION_SUPABASE_SECRET_KEY`.
The URL must be the exact HTTPS project origin, the bucket must be explicitly
chosen and cannot have a staging name, and the existing private-storage adapter
checks bucket metadata before serving requests. Independently review Storage
RLS/policies and prove unauthorized reads fail; metadata alone cannot certify
access control. Do not switch storage providers for existing customer files
without checking their stored provider/bucket bindings and migration needs.

Startup probes Firebase Auth administration, the named Firestore database and
the selected private storage before opening a port. Tokens use Firebase Admin
signature and revocation verification; unsigned emulator tokens are refused.
The listener supports Render's `PORT`, binds `0.0.0.0`, and drains on SIGTERM.
Errors do not print provider credential bodies.

## Remaining before launch

- Supply and verify production runtime credentials and exact provider resources.
- Wire the production frontend through a tested same-origin route or explicit
  authenticated cross-origin integration; this command serves API routes only.
- Implement and test production manual paid checkout separately. It is still
  hard-disabled; automated gateways/webhooks remain disabled.
- Verify real Buyer/Seller/Admin journeys, existing data and file compatibility,
  direct-access denial, rules and rollback before changing live routing.

Local verification covers configuration rejection, existing auth/ownership and
staging regressions, TypeScript and the frontend build. It does not prove real
production IAM, Storage policies, Firebase connectivity or a public cutover.
