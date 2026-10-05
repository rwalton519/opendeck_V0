# Card Deposit Confirmation — Reference Implementation

## Why this exists

The OpenDeck backend has always had two of the three pieces of a real card deposit flow:

1. `POST /wallet/deposit` — creates a genuine Stripe PaymentIntent and returns its
   `client_secret`. Funds are **not** credited at this point.
2. `POST /wallet/webhooks/stripe` — the only thing that actually credits the deposit,
   triggered by Stripe once the PaymentIntent succeeds. Signature-verified, idempotent.

What was missing was the middle piece: something running in the user's browser to actually
collect card details and confirm the PaymentIntent with Stripe using that `client_secret`.
Without it, a deposit could be *started* but never *completed* — there was no way for a real
card charge to happen at all.

**This package was not integrated into OpenDeck's actual frontend repository** — only the
backend codebase was available. These are drop-in files meant to be copied into the real
frontend project (a Vite/React/TypeScript app per the codebase's own documentation) and
adapted to its existing conventions.

## What's here

- `src/api/wallet.ts` — API client functions matching the backend's actual response shapes
  exactly (read directly from `routers/wallet.js`, not guessed).
- `src/components/DepositForm.tsx` — the actual missing piece: calls
  `stripe.confirmPayment()` against Stripe's PaymentElement to complete the charge.
- `src/components/DepositPage.example.tsx` — an illustrative page wiring the two-step flow
  together end to end (start deposit → mount Stripe Elements → confirm).

## Integration steps

1. Copy `src/api/wallet.ts`'s functions into (or merge with) the frontend's existing API
   client module.
2. Copy `src/components/DepositForm.tsx` into the frontend's components directory.
3. Install the Stripe client libraries in the frontend project:
   ```
   npm install @stripe/stripe-js @stripe/react-stripe-js
   ```
4. Add the Stripe **publishable** key (safe to expose client-side — this is not the same as
   the backend's `STRIPE_API_KEY` secret key) to the frontend's environment:
   ```
   VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
   ```
5. Wire `DepositForm` into the existing deposit UI following the pattern in
   `DepositPage.example.tsx`: call the deposit-start endpoint, get back a `client_secret`,
   mount `<Elements>` with it, then render `<DepositForm>` inside.
6. Point `returnUrl` at wherever the frontend wants users to land after a redirect-based
   payment method (most card payments won't redirect at all — `redirect: 'if_required'` is
   already set in `DepositForm.tsx`).

## What this does not change

- The backend PaymentIntent creation and webhook crediting logic — both already real, both
  untouched.
- Anything about ACH, non-Monero crypto, or other payment methods — this package is
  card/Stripe deposits only, matching what the backend actually supports end to end.

## What this does not include

- Any of OpenDeck's actual UI styling, layout, or state-management conventions — the
  components here are functional but deliberately unstyled, since the real frontend's design
  system wasn't available to match against.
- Withdrawal UI — this package is the deposit *confirmation* step specifically, which was
  the identified gap. Withdrawals already have a working (if manually-reviewed) flow on the
  backend and weren't reported as missing a frontend piece.
