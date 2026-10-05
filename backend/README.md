# transparent_poker / OpenDeck backend — merged & rebuilt

This is the three previously-delivered chunks (`chunk1`, `chunk2`, `chunk3`)
merged into one working root, plus the auth patch, plus a full rebuild of
the wallet and tournament routes to match `frontend_new/src/api/wallet.ts`
and `api/tournaments.ts` exactly. **Replace your entire `backend_new`
contents with this folder** rather than trying to hand-merge — there were
too many interacting fixes to apply piecemeal safely.

## What changed, in order of how much it matters

### 1. There was no migration for the real database schema (blocking)
The only migration in the whole project created a `users` table with a
**UUID primary key, `password_hash`, and no `username` column** — while
every route in every chunk uses the real `User` Sequelize model (integer
auto-increment id, `email`, `username`, `password`). Same story for
`wallets`/`transactions`/`tournaments` — the migration's versions and the
real Sequelize models (`wallet_balance`, `wallet_transactions`,
`tournaments` with the full size/stake/state schema) don't match at all.
**Every register/login call would have failed with a raw SQL error.**

Fixed pragmatically: `db/syncModels.js` requires every model file
(including the three under `services/game/models/` that `models/index.js`
never pulled in) and calls Sequelize's `sync()` at startup, so tables are
created directly from the model definitions that are actually running. This
runs automatically before the server starts listening.

**This is a bootstrap, not a long-term answer.** `sync({ alter: true })`
(opt-in via `DB_SYNC_ALTER=true`) isn't guaranteed safe against data loss on
real schema changes. Once there's real user data you care about, this
should be replaced with proper `node-pg-migrate` migrations written against
each model. The old mismatched migrations are left in `migrations/` rather
than silently deleted — remove them once you've moved to real ones.

### 2. Wallet and tournament routes were rebuilt from the frontend's actual contract
Not merged — **rebuilt**. Three different, mutually-inconsistent versions of
the wallet routes existed across chunk1/chunk2 (different paths, different
request/response shapes, none matching what `api/wallet.ts` actually calls).
Same for tournaments. `routers/wallet.js` and `routers/tournaments.js` are
new files written directly against those two frontend files:

- `GET /wallet/balance?user_id=X` → `{ balance }`
- `GET /wallet/transactions?user_id=X` → `{ transactions: [...] }`
- `POST /wallet/deposit` / `/wallet/withdraw` → `PaymentResult` shape
- `GET /wallet/crypto-deposit-address` / `-status`
- `GET /tournaments`, `GET /tournaments/:id`, `POST /:id/register|rebuy|addon`, `GET /:id/table_state`, `GET /tournaments/user/:userId/tickets`

Design decisions worth knowing:
- **Deposits settle instantly**; **withdrawals freeze funds and wait for
  admin approval** (`GET/POST /admin/withdrawals/*`, also new). This uses
  `WalletManager.freeze`/`.finalizeLocked`/`.unfreeze` — the same machinery
  already built for cashgame/tournament buy-ins, not new logic.
- **Crypto deposit addresses only work for ETH and XMR** — those are the
  only two assets with a real address-generation backend anywhere in any
  chunk (`usdcWallet.js` for ETH, `cryptoService.js` for Monero/XMR). BTC
  and any other asset return a 501, matching a comment already in
  `api/wallet.ts` acknowledging this endpoint may need to surface a real
  error state.
- **Crypto deposit *status* is a flagged stub** — always reports
  unconfirmed. No chunk includes actual blockchain monitoring; wiring this
  up needs either a provider webhook or a polling job, neither of which
  exists yet.
- Transaction history is sourced from the ledger (`services/wallet/ledger.js`),
  which these routes write to on every *settled* movement — deliberately not
  at the pending/frozen stage, so every row this API returns can honestly be
  stamped `"succeeded"`.

### 3. Real login (from the previous patch, included here)
`/auth/login` does a real bcrypt check against `users` and returns a signed
JWT + `user_id`, matching `AuthContext.login()`'s expectations. Also fixed:
dangling `Admin` model import, a Sequelize call passing `db` as a first
argument (not how Sequelize works), a `parseInt()` on a UUID admin id, and
admin JWTs being signed with a different secret than `wsAuth.js` verifies
against.

### 4. CORS
Added — without it, the browser blocks every request from the React app
(different origin/port) before it reaches any route. `CORS_ORIGIN` in
`.env` controls allowed origins.

## Explicitly NOT addressed here (out of scope for this pass)

- **`routers/kyc_router.js`, `routers/payments_router.js`,
  `routers/compliance_router.js`**: left as chunk2 originally converted
  them. No mismatch against the frontend was found for these (the frontend
  doesn't appear to call them yet), so they weren't rebuilt — but they
  weren't specifically verified either.
- **`services/game/wsAuth.js` / `api/routes/wsRouter.js`'s
  `CashGameTable.findOne(db, {...})`**: same wrong-Sequelize-call-signature
  bug flagged in the chunk3 README, still unfixed — websocket table lookups
  will throw until this is corrected. Out of scope since it's unrelated to
  wallet/tournament/login.
- **`admin/adminRouter.js`'s pre-existing `/approve_payout`,
  `/reject_payout`, `/freeze_user`, `/unfreeze_user`,
  `/tournament/advance_level`, `/tournament/finalize`**: call methods that
  don't exist on `ComplianceManager`/`TournamentManager`
  (`approvePayout`, `freezeUser`, `advanceLevel`, etc. were never
  implemented in any chunk). Left alone — separate, pre-existing gap, not
  part of what was asked this round.
- **Cashgame routes** (`api/routes/cashgameRouter.js`): unchanged, no
  frontend mismatch was checked for these since no `api/cashgame.ts`
  exists yet on the frontend side.

## Payments path — wired to real providers (latest pass)

Three provider stubs (`services/payments/provider{Stripe,Ach,Crypto}.js`)
used to return hardcoded fake success data with zero real API calls — a
real `STRIPE_API_KEY` would have done nothing, since nothing in the path
your frontend actually calls ever used it. Fixed per-provider, honestly:

### Stripe (card/debit/square/eWallet) — now real
`providerStripe.js` calls the real `stripeService.js` (actual Stripe SDK).
But a card payment is **asynchronous** — creating a PaymentIntent doesn't
mean the customer paid. So the flow is now:
1. `POST /wallet/deposit` creates a real PaymentIntent, returns its
   `client_secret` in the response (`data.client_secret`) — **does not
   credit the wallet yet.**
2. Your frontend needs to actually complete the payment client-side (Stripe
   Elements + `confirmCardPayment(client_secret)`) — this doesn't exist on
   the frontend yet and needs to be added.
3. **`POST /wallet/webhooks/stripe`** (new) is what actually credits the
   wallet, triggered by Stripe's own webhook when the PaymentIntent
   succeeds. Signature-verified, idempotent (safe against Stripe's webhook
   retries). Needs `STRIPE_WEBHOOK_SECRET` set, and Stripe needs to be
   configured (Dashboard or `stripe listen` locally) to actually send events
   to this URL.

### ACH (bankTransfer/eTransfer) — honestly not wired
`achService.js`'s real ACH debit call needs a Stripe `customerId` and a
linked bank account (`paymentMethodId` from Financial Connections) — this
codebase has no bank-account-linking flow anywhere, frontend or backend.
Rather than fabricate placeholder values that would fail against Stripe (or
worse, silently succeed against the wrong account), `providerAch.js` now
throws a clear 501 explaining exactly what's missing. Building the linking
flow is a separate, larger piece of work.

### Crypto — doesn't fit the same pattern, rebuilt around that reality
Crypto deposits don't have an "amount, initiate, poll for completion"
shape the way card payments do — you generate a stable address, the user
sends an on-chain transaction of whatever amount, and you wait for
confirmations. `providerCrypto.js` (used only for `PaymentManager`'s
generic method-mapping) now honestly rejects with a message pointing at the
real flow instead of faking a synchronous deposit:
- `GET /wallet/crypto-deposit-address` (already existed) — real address
  generation for ETH/XMR.
- **`POST /wallet/crypto-deposit-confirm`** (new) — takes a real
  transaction id, checks it against `cryptoService.checkConfirmations()`
  (real `monero-wallet-rpc` JSON-RPC call), and credits the wallet once
  confirmed. Idempotent against being called twice for the same txid. Only
  XMR is supported — no confirmation-checking implementation exists for
  ETH or BTC anywhere in this codebase.
- Nothing automatically watches for incoming transactions — a real user
  still needs to submit their txid to this endpoint (or a monitoring
  worker needs to be built to do that automatically). Not fabricated as
  "already automated."

### A real bug this surfaced: missing `await`s
`PaymentManager.deposit()`/`withdraw()`/`refreshStatus()` never awaited
their provider calls — invisible while every provider was a synchronous
stub returning a plain object, but would have silently broken (setting
`external_id` to a pending Promise instead of a real id) the moment any
provider became genuinely async, which is exactly what just happened.
Fixed alongside the provider wiring.

### Still not addressed (separate scope)
- **Real payouts** (withdrawals actually leaving the platform to a user's
  bank/card): `stripeService.createPayout()` still doesn't do what its name
  implies (creates another PaymentIntent, not a real transfer) — needs
  Stripe Connect or a linked external account, neither of which exists.
  Admin withdrawal approval still only finalizes the *internal* ledger
  (`WalletManager.finalizeLocked`), not an actual outbound transfer.
- **Crypto withdrawal payouts**: `cryptoService.sendWithdrawal()` is real
  and complete, but nothing calls it yet — admin approval doesn't collect
  or use a destination address for crypto withdrawals.
- **Circle/MoonPay** (`circleService.js`/`moonpayService.js`): real SDK
  wrapper code exists but nothing routes to them at all yet.



```bash
npm install
cp .env.example .env
# fill in SECRET_KEY, DATABASE_URL, CORS_ORIGIN for your setup
npm start
```

On startup, the server will sync the database schema to match the models,
then start listening. Watch the console — a failed sync means Postgres
isn't reachable or `DATABASE_URL` is wrong, and the process exits rather
than starting half-broken.

## Real payouts — Stripe Connect + crypto withdrawal wiring (latest pass)

Withdrawal approval used to only ever finalize the *internal* ledger
(`WalletManager.finalizeLocked`) — no real money ever actually left the
platform for any method, regardless of what admin clicked. Fixed for the
two methods that can actually be made real without inventing missing
infrastructure:

### Stripe Connect (card/debit/square/eWallet withdrawals)
Real payouts to a user's bank account need Stripe to know *whose* bank
account - that's what Connect is for. Added:
- **`POST /wallet/stripe-connect/onboard`** — creates a Stripe Express
  connected account for the user (first time only) and returns a
  Stripe-hosted onboarding URL. The user completes ID verification and
  bank-account entry on Stripe's own page, not anything built here.
- **`GET /wallet/stripe-connect/status`** — reports whether onboarding is
  complete (`payouts_enabled`).
- `providerStripe.js`'s `createWithdrawal()` now does a **real Stripe
  Transfer** to the user's connected account — but only if they've actually
  finished onboarding. If not, it throws a clear, specific error rather
  than pretending to send money. Admin approval surfaces that error
  directly and does **not** finalize the withdrawal if the real transfer
  failed - funds stay frozen so it can be retried once the user finishes
  onboarding, instead of silently releasing funds nothing actually paid out.
- **One thing this doesn't do**: guarantee the money lands in the user's
  bank account instantly. A Transfer moves funds to the connected account's
  Stripe balance; Stripe pays that out to their actual bank on its own
  schedule (daily by default for Express accounts) - that's standard Stripe
  behavior, not a gap in this integration.
- **Nothing on the frontend calls these two new endpoints yet** — a
  "Set up payouts" UI flow (redirect to the onboarding URL, handle the
  return) needs to be built there before a real user can go through this.

### Crypto withdrawal (Monero only)
`cryptoService.sendWithdrawal()` was already real and complete, but nothing
called it. Now:
- `POST /wallet/withdraw` accepts an optional `address` field (not
  currently part of `api/wallet.ts`'s `withdraw()` signature — needs adding
  there too) and **requires** it specifically for `method: "cryptoMonero"`,
  since that's the only crypto method with a real send capability anywhere
  in this codebase. Stored on the new `destination_address` column.
- Admin approval calls `cryptoService.sendWithdrawal()` for real when the
  method is `cryptoMonero` and an address was provided. On success, the
  real Monero transaction hash is stored in the new `payout_reference`
  column. On failure, same honest behavior as Stripe — the withdrawal stays
  pending rather than being marked paid.
- BTC/ETH/other crypto withdrawals still have no real send capability
  anywhere (same reason as before — no transaction-construction/broadcast
  logic exists for those chains) and still fall through to internal-ledger-
  only approval.

### What "internal-ledger-only" approval means now, explicitly
For methods with no real payout path (ACH, cryptoBtc/cryptoEth/cryptoOther),
approving a withdrawal still only releases the internal lock — same
behavior as before this pass, not newly broken by it. The difference is the
response now says so explicitly (`real_payout_attempted: false`) instead of
returning an identical `{status: "ok"}` regardless of whether real money
moved or not. `GET /admin/withdrawals/pending` also now returns a
`has_real_payout` flag per request so an admin UI can show this before
anyone clicks approve.

### New model columns (`models/real_money.js`, `WithdrawalRequest`)
`destination_address` (crypto payout target), `payout_reference` (the real
transfer id / transaction hash once sent), `failure_reason` (why a real
payout attempt failed, if it did). Picked up automatically by the existing
`db/syncModels.js` bootstrap — no separate migration step needed for this
merge, per the same caveat as before about that being a stand-in for real
migrations long-term.

## Testing the full loop

```bash
# Register
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","username":"you","password":"yourpassword"}'

# Login
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"yourpassword"}'
# -> { "token": "...", "user_id": 1, ... }

# Balance (should be 0 for a new user)
curl "http://localhost:8000/wallet/balance?user_id=1"

# Deposit
curl -X POST http://localhost:8000/wallet/deposit \
  -H "Content-Type: application/json" \
  -d '{"user_id":"1","amount":100,"method":"card"}'

# Balance again (should now be 100)
curl "http://localhost:8000/wallet/balance?user_id=1"
```

### Testing Stripe Connect onboarding

```bash
curl -X POST http://localhost:8000/wallet/stripe-connect/onboard \
  -H "Content-Type: application/json" \
  -d '{"user_id":"1","email":"you@example.com","refresh_url":"http://localhost:5173/wallet","return_url":"http://localhost:5173/wallet"}'
# -> { "url": "https://connect.stripe.com/setup/..." } - open this in a browser

curl "http://localhost:8000/wallet/stripe-connect/status?user_id=1"
# -> { "onboarded": false, "payouts_enabled": false, ... } until you finish Stripe's onboarding form
```

### Testing crypto withdrawal (requires a running monero-wallet-rpc)

```bash
curl -X POST http://localhost:8000/wallet/withdraw \
  -H "Content-Type: application/json" \
  -d '{"user_id":"1","amount":10,"method":"cryptoMonero","address":"<a real XMR address>"}'
# -> { "success": true, "transactionId": "<withdrawal id>", ... }, funds frozen

# As admin (with an admin JWT):
curl -X POST http://localhost:8000/admin/withdrawals/approve \
  -H "Content-Type: application/json" -H "Authorization: Bearer <admin token>" \
  -d '{"id":"<withdrawal id>"}'
# -> { "status": "ok", "real_payout_attempted": true, "payout_reference": "<real txid>", ... }
```

Once that round-trips, point the frontend at this backend for local testing.
**One more bug worth knowing about**: `frontend_new/src/config/env.ts`'s
`apiBaseUrl` was hardcoded to `https://opendeck.ca/webapp` and never
actually read from an env var at all (unlike `wsBaseUrl` right next to it,
which correctly reads `VITE_WS_BASE_URL`) — so every API call always hit
production regardless of environment, and local testing against
`localhost:8000` was impossible as written. Fixed in a small patch to that
file (included alongside this one) so it now reads `VITE_API_BASE_URL`,
falling back to the same production URL if unset. Add to your frontend's
`.env.local`:
```
VITE_API_BASE_URL=http://localhost:8000
```

## Admin Dashboard

`public/admin/index.html` (frontend_new project, served the same way
`public/cashgame-demo/index.html` is - a static file at `opendeck.ca/admin/`,
outside the SPA's client routing) is a small internal ops dashboard: a
running accounting ledger (all deposits/withdrawals/buy-ins/payouts, newest
first), an accounts table (uid, username, email, signup IP, last-login IP,
balance, total deposits, open fraud-flag count) with a one-click
freeze/unfreeze button per row, a fraud review queue backed by the existing
`ComplianceFlag` rows `ComplianceManager.runChecks()` already writes, and a
pending-withdrawals queue with approve/reject.

**Auth:** there is no separate/parallel auth system here. The dashboard's
login page is a plain client for the *existing* `POST /admin/login`
(`admin/adminAuth.js`) - same JWT, same `requireAdmin` middleware every
other admin route already used. `migrations/1745000700000_admin-dashboard.js`
seeds one real `admins` row (`rwalton22`) so that login actually works out
of the box; see that migration's header comment for how to change the
password (there is no in-app "change admin password" flow yet - flagged as
a gap, not worked around).

**New backend surface**, all under the same `/admin` prefix and the same
`requireAdmin` auth as everything else in `admin/adminRouter.js`:

- `GET /admin/dashboard/summary` - user/frozen/pending/flag counts, total balance held, total deposits, total withdrawals.
- `GET /admin/dashboard/ledger?limit=&offset=` - every `WalletTransaction` row across every user (this is the "running accounting ledger").
- `GET /admin/dashboard/accounts` - one row per user, joined in-app (see `admin/adminDashboardRouter.js`'s header comment on why - no formal association exists between `User` and the wallet/compliance tables).
- `GET /admin/dashboard/fraud-flags?resolved=false` / `POST /admin/dashboard/fraud-flags/:id/resolve`.
- Freeze/unfreeze re-use the pre-existing `POST /admin/freeze_user` / `POST /admin/unfreeze_user` - no new endpoint needed for that part.

**Bug fixed while building this:** `GET /admin/ledger/:user_id` in
`admin/adminRouter.js` called `WalletManager.getLedger()`, a method that
does not exist anywhere on that class - this route would have thrown on
every call. Fixed to call the real ledger reader,
`Ledger.getUserTransactions()` (`services/wallet/ledger.js`), the same one
`GET /wallet/transactions` already uses.

**IP tracking is new.** Nothing in this codebase captured a client IP
anywhere before now - `services/payments/achService.js` even has a literal
`ip_address: '127.0.0.1', // replace with real client IP` placeholder.
`signup_ip` is captured on `POST /auth/register`; `last_login_ip` /
`last_login_at` on `POST /auth/login`. This requires
`app.set('trust proxy', 1)` (added in `server.js`) so `req.ip` reflects the
real client through nginx rather than nginx's own address - see that
line's comment for exactly what it does and does not trust.

**Deployment note**, same category as the `/cashgame-demo` trailing-slash
item: this is a static file, so the same `try_files` behavior applies -
`opendeck.ca/admin/` (with the trailing slash) will resolve; a bare
`opendeck.ca/admin` may fall through to the SPA without the same one-line
nginx redirect already documented for `/cashgame-demo`. `/admin/withdrawals`
(the existing React route) is unaffected either way - it's a different,
longer path.

**Tested against a real Postgres instance** (migration run, admin seeded,
every endpoint exercised with curl: register → login → admin login →
summary/accounts/ledger/fraud-flags → freeze → unfreeze → resolve flag →
create a withdrawal → approve it → confirm it lands in the ledger and the
summary totals update correctly) before this was written up - not just
syntax-checked.
