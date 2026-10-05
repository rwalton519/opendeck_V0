# Implemented known-gap fixes

This delivery makes `node-pg-migrate` the normal schema path and verifies
that every checked-in migration has been applied before boot. `DB_SYNC_ALTER`
remains an explicit development-only escape hatch.

ACH now uses Stripe Financial Connections: create a client session with
`POST /wallet/ach/link-session`, complete the Stripe.js flow, then post the
session id to `/wallet/ach/link-complete`. Deposits use the stored tokenized
bank payment method; outbound ACH is sent through the user's Stripe Connect
bank-onboarded account.

Crypto deposit watches are stored in `crypto_deposits` and polled by the
startup worker. BTC requires a Bitcoin Core wallet RPC; ETH requires an
Ethereum JSON-RPC endpoint; XMR manual confirmation remains supported for
privacy-wallet transaction identifiers. The status endpoint returns observed
transactions and confirmation counts instead of a constant response.

Admin payout approval now attempts a real transfer for Stripe/ACH, BTC, ETH,
and XMR. Any transfer failure leaves the withdrawal pending and its funds
locked. Required configuration is listed in `.env.example`.
