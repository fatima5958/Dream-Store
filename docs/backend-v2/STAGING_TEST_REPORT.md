# Backend V2 Staging Test Report

## Scope and environment

This report covers repository tests, local Firebase emulators and GitHub Actions for the latest tested commit. Firebase emulators use `demo-dreamstore-v2`, synthetic users/payment references and `firebase.v2.emulator.json` with named Firestore rules. No production Firebase services or customer data were used.

## Current Phase 7 local results

| Suite | Result |
|---|---:|
| `npm run lint` | Passed — TypeScript no-emit check |
| `npm run test:v2` | Passed — 74 tests |
| `npm run test:contracts` | Passed — 51 tests |
| `npm run test:server` | Passed — 26 tests |
| V2 Auth + named Firestore + Storage emulator integration | Passed — 6 tests |
| Firestore/Storage rules emulator | Passed — 10 tests |
| `npm run build` | Passed; Vite reports the existing large JavaScript chunk warning |
| Local browser smoke | Not run on this commit; CI browser smoke is required |
| Local Docker production-container test | Not available; Docker is not installed in this workspace |

The V2 emulator integration includes real Firebase Auth tokens, store/product/upload/order flows, dispute races, First 100 claims, Admin claims, invalid tokens, Buyer isolation and historical Buyer restoration. It passed against the final local Phase 7 code. Browser and production-container checks will be reported from the new Phase 7 GitHub Actions run.

## Cloud staging

**BLOCKED — no dedicated staging Firebase project, verified Cloud Run service identity, IAM grants or authorized private deployment were available.** Current V2 startup remains demo-project plus loopback-emulator only. No production traffic, Firebase writes or payment activity occurred.

OAuth and Google redirect registration have not been verified against a staging Firebase/Google project. External Gemini generation was not exercised; by default the assistant uses the local fallback. Email delivery and real payment evidence remain external/manual.
