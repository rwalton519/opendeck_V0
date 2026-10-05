# Card deposit — endpoint contract

This closes the one open question from **OpenDeck Frontend Executive
Summary v2.0**, "What's Still Open → 1. Card deposits are drafted, not
live": *"confirming exactly what the deposit endpoint returns for a card
payment today."*

## The endpoint to call

**`POST /wallet/deposit`** (`routers/wallet.js`) — this is the canonical,
frontend-contract-matching endpoint. It is not new; it already exists and
is already wired to a real Stripe `PaymentIntent`.

There is also a legacy `POST /payments/deposit?user_id=...&amount=...`
(`routers/payments_router.js`) left over from an earlier conversion chunk.
It now delegates to the same code path as `/wallet/deposit` (see
`CHANGELOG_FIXES.md`) so it's no longer a dead end, but it should be
treated as deprecated. Build the new frontend UI against `/wallet/deposit`.

## Request

```
POST /wallet/deposit
Content-Type: application/json

{
  "user_id": "123",
  "amount": 50,
  "method": "card"
}
```

`method` must be one of the values `METHOD_TO_PROVIDER` in
`utils/paymentMethods.js` maps to the `stripe` provider: `"card"`,
`"debit"`, `"square"`, or `"eWallet"`. All four behave identically today
(they all route to Stripe) — `"card"` is the one to use for a standard
credit/debit card form.

## Response — success (card/debit/square/eWallet)

```json
{
  "success": true,
  "message": "Payment initiated - complete it on the client using the returned client secret.",
  "transactionId": "482",
  "data": {
    "method": "card",
    "provider": "stripe",
    "client_secret": "pi_3P...secret_xY..."
  }
}
```

TypeScript shape:

```ts
interface CardDepositInitiatedResponse {
  success: true;
  message: string;
  transactionId: string;       // PaymentRecord id, as a string
  data: {
    method: 'card' | 'debit' | 'square' | 'eWallet';
    provider: 'stripe';
    client_secret: string;     // pass straight into Stripe.js
  };
}
```

## Response — validation / rejection

```json
{ "detail": "amount must be a positive number" }
```

via the shared `HttpError` handler (`middleware/errorHandler.js`), on a
non-2xx status code (400 for bad input, 400 for an unsupported `method`).

## What the response does *not* mean

**The deposit is not complete when this call returns.** A Stripe
`PaymentIntent` starts in `requires_payment_method` /
`requires_confirmation` — creating it is step 1 of 3, not the whole flow.
The wallet balance is **not** credited yet at this point.

## The full flow (all three steps)

1. **`POST /wallet/deposit`** (above) → returns `client_secret`. A
   `PaymentRecord` is created server-side with `status: pending` and
   `external_id` set to the Stripe PaymentIntent id.
2. **Client-side, in the frontend**: use `client_secret` with Stripe.js
   (`stripe.confirmCardPayment(client_secret, { payment_method: {...} })`)
   to actually collect and submit the card details. This step happens
   entirely in the browser against Stripe's API, not against this backend.
3. **`POST /wallet/webhooks/stripe`** (`routers/walletWebhooks.js`) — Stripe
   calls this backend directly (not the frontend) when the PaymentIntent
   reaches `payment_intent.succeeded`. This is what actually credits the
   wallet (`WalletManager.credit` + a ledger entry) and flips the
   `PaymentRecord` to `completed`. It's idempotent against Stripe's webhook
   retries.

The frontend can poll `GET /wallet/balance?user_id=X` after step 2 to
detect when the credit has landed, or optimistically show "payment
processing" until the next balance refresh. There is currently no
endpoint that reports a single deposit's status by `transactionId`
directly — `PaymentManager.refreshStatus()` exists server-side but isn't
exposed as a route. Flagging this as a small, separate follow-up if the
frontend wants precise per-deposit status rather than polling the overall
balance.

## Known open item — currency

`services/payments/stripeService.js#createDepositIntent` hardcodes
`currency: 'usd'`. OpenDeck is live at `opendeck.ca`; if deposits should be
charged in CAD instead, that's a one-line change in that method, but it's
a product decision (and matters for what's shown in the card form / Stripe
Elements config on the frontend side), not something changed silently
here.

## What frontend still needs (not in this backend delivery)

This backend contract is now fixed and stable. The remaining work is
frontend-side, in the separate `frontend_new` project:

1. Install `@stripe/stripe-js` and `@stripe/react-stripe-js`.
2. Add an API client function that calls `POST /wallet/deposit` with
   `method: 'card'` and returns the typed response above.
3. A card entry component using Stripe Elements that takes the
   `client_secret` from step 2 and calls `stripe.confirmCardPayment(...)`.

See the chat response accompanying this delivery for ready-to-paste code
for items 2 and 3.
