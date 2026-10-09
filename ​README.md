# Udaan Credit — source project (pre-deployment)

This is a runnable React + TypeScript + Firebase foundation for the Udaan Credit website. It is **not yet a complete production fintech platform**: the public site, bilingual shell, phone OTP flow, consent-based loan enquiry, customer application list, baseline Firestore/Storage rules, and starter trusted backend functions are included. Admin screens, full customer/loan CRUD, staff management UI, referral portal workflows, notification delivery, and end-to-end security tests still need implementation and review. Do not publish until those are complete and the rules are tested against your Firebase project.

## Folder structure

- `src/App.tsx` — routes, navigation, language switcher, auth state
- `src/pages/` — home, apply form, contact, customer portal
- `src/components/PhoneLogin.tsx` — Firebase phone OTP login
- `src/lib/firebase.ts` — Firebase web SDK initialization
- `src/lib/applications.ts` — validated application submission
- `src/lib/types.ts` — shared data types
- `functions/src/index.ts` — trusted backend function examples (bootstrap, assignment, commission, payout recording)
- `firestore.rules`, `storage.rules` — least-privilege starter rules
- `firestore.indexes.json` — indexes used by starter queries
- `tests/validation.test.ts` — starter unit tests

## Local setup

1. Install Node.js 20 or newer and npm.
2. Create/select your Firebase project. Register a **Web App** in Firebase Console.
3. Copy `.env.example` to `.env.local` and fill in the Firebase Web App configuration. These values are intended for the browser; never add service-account credentials here.
4. In Firebase Console, enable Phone sign-in under Authentication. Configure authorized domains for localhost when testing. Phone auth uses reCAPTCHA and requires Firebase project configuration and may have SMS quotas/costs.
5. Install frontend dependencies: `npm install`.
6. Start local dev server: `npm run dev`.
7. Build check: `npm run build`; tests: `npm test`.
8. For backend: `cd functions && npm install && npm run build`.
9. Install Firebase CLI separately, sign in, select the correct project, then run `firebase emulators:start` from the project root to test rules/functions locally. Do not deploy yet.

## Firebase security setup

- Review every rule against the actual workflows before use. The default catch-all denies access.
- Custom claims (`role`, `permissions`) must be granted only by trusted Admin SDK functions. Do not set them from client code.
- Enable Firebase App Check for the web app and enforce it for callable functions after valid app configuration.
- Enable Authentication email verification for the designated bootstrap identity. Set the secret only in trusted functions configuration: `firebase functions:secrets:set UCMF_BOOTSTRAP_SECRET`. Never place it in `.env.local` or frontend code.
- The bootstrap callable requires a verified email identity and the one-time secret, then records completion. For production, restrict the eligible bootstrap identity further (e.g. allowlisted email/domain or deployment-controlled identity) before invoking it. The function returns custom claims; sign out/in to refresh them.
- Deploy rules and functions only after emulator and security review. Deployment commands are intentionally not run.

## Important limitations before production

- The admin panel and full CRUD modules are not implemented in this starter.
- Phone OTP depends on Firebase Console configuration and real device/authorized test-number setup.
- Current customer portal only lists the signed-in user's application records. It does not invent loan balances, approvals, repayments or payment confirmations.
- Loan-account, repayment, payment, commission and payout writes are denied from the client; trusted backend workflows and audited admin UI must be completed and tested before launch.
- The referral route is informational, not a complete partner registration dashboard.
- Email and WhatsApp integrations are not active. Add a provider and secret-backed backend integration later.
- The `recordConfirmedPayout` function only records an authorized operator's confirmed manual payment reference; it does not transfer money or independently verify a bank transfer.
- `assignEnquiry` assumes staff workload counters are maintained consistently. For production, all assignment/reassignment/closure paths must update the counters transactionally and concurrency tests must be added.
- Legal disclosures, privacy policy, complaints handling, lender agreements, commission terms, data retention, consent and applicable Indian regulatory requirements need review before launch.

## Later Netlify setup (do not publish yet)

Build command: `npm run build` · Publish directory: `dist`. Add the Firebase web configuration as Netlify environment variables only when deployment is approved. Configure SPA rewrites so routes resolve to `/index.html`. Firebase Functions and Firestore rules are deployed through Firebase, not Netlify.
