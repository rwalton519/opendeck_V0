# Stripe Elements / Connect frontend screens

Completes the client-side half of item 8 in `CHANGELOG_FIXES.md` ("Client-side Stripe
Elements confirmation flow — not done, is frontend work") and wires up
`routers/walletStripeConnect.js`, which nothing on the frontend has called yet.

Two screens, both real working components against the real backend contract - only the
Stripe API calls themselves use placeholder/env-driven keys, since those are secrets you own:

- **`CardDepositForm.tsx`** — deposit money via card. Calls `POST /wallet/deposit` for a
  `client_secret`, then `stripe.confirmCardPayment()` directly against Stripe. The wallet
  balance updates asynchronously via the backend's Stripe webhook, not synchronously here -
  see the comment block at the top of the file and `docs/DEPOSIT_CARD_PAYMENT_CONTRACT.md`.
- **`PayoutOnboarding.tsx`** — "Set up payouts" screen. Calls
  `POST /wallet/stripe-connect/onboard` for a Stripe-hosted onboarding link and redirects
  the browser there; Stripe handles ID verification and bank account collection entirely on
  their end.

## Integrating into `D:\projects\web_app_v2\frontend`

1. Copy `src/api/stripePayments.ts` and `src/components/*.tsx` into your existing frontend's
   `src/api/` and `src/components/` (or wherever matches your current structure).
2. `npm install @stripe/stripe-js @stripe/react-stripe-js` (see
   `package.json.additions.json`).
3. Add `VITE_STRIPE_PUBLISHABLE_KEY` and `VITE_API_BASE_URL` to your `.env` (see the same
   file for what each should be — the publishable key is the public `pk_...` key, safe to
   ship client-side; never put the secret `sk_...` key anywhere in frontend code).
4. Drop `<CardDepositForm userId={...} />` into your wallet/deposit page, and
   `<PayoutOnboarding userId={...} userEmail={...} />` into your wallet/withdraw page behind
   a "Set up payouts" affordance.
5. No CSS is included — class names (`deposit-form`, `payout-onboarding`, etc.) are there for
   you to style to match the rest of the app; nothing is inline-styled or Tailwind-coupled.

## What's still a placeholder

- The Stripe **publishable key** (`VITE_STRIPE_PUBLISHABLE_KEY`) — get this from the Stripe
  Dashboard → Developers → API keys. Test mode (`pk_test_...`) is fine for development.
- The `return_url`/`refresh_url` values passed to Connect onboarding — currently point at
  `/wallet/payouts/onboarding-complete` and `/wallet/payouts/onboarding-refresh`, which don't
  exist yet. Point them at real routes once you decide where those should live in the app's
  router.
- Everything else (the API calls, the Stripe confirmation calls, the response handling) is
  real, working code against the backend as it exists today — not scaffolding to rewrite,
  just secrets and routing to fill in.
