# DreamStore production deployment (Cloud Run)

The application already runs in production mode with `npm start`. The Dockerfile packages the compiled Vite frontend and Express backend using Node 24. It is **not** an authorization to accept paid transactions.

## Pre-release checks

1. Review `DEPLOYMENT_CHECKLIST.md` and `QA_REVIEW.md`. Resolve outstanding high-priority data integrity and authorization issues before paid launch.
2. Back up the named Firestore database and Storage. Validate the deployed rules against the production database and bucket; emulator success is not proof of production access.
3. Verify the Cloud Run service identity can read/write only required Firebase resources. Enable Firebase Email/Password and Google sign-in for the deployed domain. Recover and migrate legacy accounts before rollout.
4. Set `SERVER_SIGNING_SECRET` to a durable random 32+ character value from Secret Manager, consistent across service instances. Set the correct `SUPER_ADMIN_UID` and keep the bootstrap secret private.
5. Set `DREAMSTORE_PAID_CHECKOUT_ENABLED=false`. Do not enable paid checkout until payment/refund/commission/download/restart testing is approved.
6. Validate actual seller and buyer workflows in an isolated staging service. Confirm `GET /api/ready` returns HTTP 200 after the environment has been configured. `/api/health` is only a liveness check.

## Build and staging

Build an image using `docker build -t dreamstore:staging .` and test locally with a dedicated non-production Firebase project and properly scoped credentials. CI builds this image and checks its liveness and fail-closed readiness without secrets. No credentials are shipped inside the image.

Cloud Run must supply `PORT`, its runtime identity, required environment variables and Secret Manager bindings. Deploy the reviewed image to a **staging service** first, using the project's authorized delivery process. Use a pinned image digest for any production rollout.

## Production release and rollback

1. Complete staging verification with two real test identities and no customer money.
2. Save the current production revision and database backup, then obtain release approval.
3. Roll the approved image digest out to Cloud Run; verify `/api/ready`, storefront/auth, protected downloads, and logs before increasing production traffic.
4. Leave paid checkout disabled and verify the UI rejects real-money checkout until financial paths have been separately approved.
5. Roll back traffic to the recorded revision if readiness, authorization, or error metrics regress. Database changes require their own rollback/migration plan.

**Limits:** This repository does not grant access to Cloud Run deployment IAM, Secret Manager, Firebase Console, production data, or domain DNS. A green GitHub Actions build does not mean a live Cloud Run revision has been deployed.
