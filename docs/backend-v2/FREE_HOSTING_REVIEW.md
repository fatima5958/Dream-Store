# Free hosting review — 2026-10-17

Scope: the existing long-running Node/Express V2 API, Firebase Auth + named Firestore, private Supabase Storage, 5 MiB binary upload contract and JSON base64 delivery. This is research, not a deployment or production recommendation. No hosting account, billing, IAM, secret or production route was changed.

| Option | Compatibility and free allowance | Actual constraints / decision |
| --- | --- | --- |
| Render Free Web Service | Full Node/Express runtime, managed HTTPS, server environment/secret configuration; external Firebase/Supabase HTTP APIs are architecturally usable. 750 free service hours/workspace/month. | Sleeps after 15 min idle; about one minute cold start; ephemeral local disk; no free persistent disk, shell or one-off jobs. External DB/object-storage traffic can trigger suspension. Bandwidth/build allowances are bounded; without a payment method excess suspends services/builds, with a payment method overage can be billed. Most plausible synthetic staging candidate; not reliable always-on production. |
| Koyeb Free Instance | Full Node/Express, HTTPS and secrets; one free web instance/org, 512 MB RAM, 0.1 vCPU, 2 GB ephemeral SSD, Frankfurt or Washington. | Scales to zero after one hour; no volumes/workers/custom scaling. Official FAQ requires card verification with a $29 preauthorization, and warns signup's selected Pro plan can be charged prorated. This fails the owner's zero-billing/card setup preference; not recommended for this milestone. |
| Vercel Hobby | HTTPS + server secrets; Express can be adapted to functions and external APIs. | Hobby is for personal non-commercial use. Functions have a 4.5 MB request/response limit: incompatible with current 5 MiB uploads and larger base64 delivery responses. The creator marketplace is commercial. Not a compatible drop-in free launch target. |

**Recommendation:** investigate Render Free only as the next isolated staging-runtime milestone, with the Free compute plan, no payment method, and synthetic data. Verify account eligibility/limits at setup time. Render exposes a public HTTPS service, so application authentication alone must not be mistaken for the current private Cloud Run invoker gate. A dedicated tester-access guard, exact staging resource/credential identity checks, Firebase credential delivery (prefer federation over long-lived keys), startup/readiness, secret management and cold-start tests must be designed and tested first.

**Current code intentionally retains Cloud Run metadata identity and Secret Manager requirements for real-cloud mode. It does not run on Render/Koyeb/Vercel as-is.** Supabase integration removes Firebase Storage billing dependency; it does not remove the existing host security/credential requirements. Do not fake `K_SERVICE`, weaken metadata checks, set emulator variables to real endpoints, or use production Firebase to work around them. Until a host is approved and its isolated secure runtime is implemented, continue local emulator/SDK-double staging. No real cloud staging success is claimed.

Supabase Free limits remain relevant independently: the official plan lists 1 GB Storage and 5 GB included egress; the Free global per-file ceiling is 50 MB. DreamStore still accepts 5 MiB. Monitor capacity/egress and paused-project behavior in the actual dashboard; no free-tier service is unlimited or an SLA.

Official sources checked 2026-10-17:

- [Render Free limitations and suspension/billing behavior](https://render.com/docs/free)
- [Render runtime and secret/environment setup](https://render.com/docs/web-services)
- [Koyeb free instance constraints](https://www.koyeb.com/docs/reference/instances)
- [Koyeb card verification and signup billing FAQ](https://www.koyeb.com/docs/faqs/pricing)
- [Vercel Hobby restrictions](https://vercel.com/docs/plans/hobby)
- [Vercel function limits](https://vercel.com/docs/functions/limitations)
- [Supabase plan quotas](https://supabase.com/docs/guides/platform/billing-on-supabase)
- [Supabase file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)
