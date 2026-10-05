# Fixes applied this pass — 2026-08-24

Verified against a real Postgres instance with the actual migrations, real
bcrypt+JWT auth, and the real live-hand engine — not stubs. Full HTTP
end-to-end tests included (`e2e_test.js`, `sidepot_test.js`).

## Bug 1 (critical): seat/chip changes were never actually saved to the DB

`services/game/buyinManager.js` (×3), `services/game/rakeManager.js`,
`services/game/settlementManager.js` all did:

```js
table.seats = seats;   // seats is the SAME object reference as table.seats
await table.save();
```

Sequelize's dirty-checking on JSONB columns compares by reference. Because
`seats` was mutated in place and then reassigned to the same reference,
Sequelize never saw a change and `.save()` silently wrote nothing. Confirmed
via direct DB inspection: after `POST /cashgame/:id/seats/:seat/take`
returned a 200 with the expected chip count, `SELECT seats FROM
cash_game_tables` showed `{}` — the seat was never actually taken.

**Impact:** taking a seat, adding chips, cashing out, rake deduction, and —
most seriously — settling chip balances after a hand's showdown were all
silently no-ops. On a real-money table this means players could win or lose
a hand and their balance would never change.

**Fix:** added `table.changed('seats', true)` before every `.save()` call at
all 5 sites, which forces Sequelize to include the field in the UPDATE.
Re-verified: a full hand now correctly moves chips between seats and the
database reflects it.

## Bug 2: `minRaise` was never exposed in hand state

`services/game/liveHandEngine.js`'s `getPublicState()` computes and enforces
`minRaise` server-side (the minimum legal raise-over-current-bet) but never
returned it to the caller. No frontend could build a raise slider, show a
"min raise: $X" label, or validate a raise amount before submitting it
without guessing. Added `minRaise: state.minRaise` to the returned object.

## Verified working (no code change needed)

- Real register/login: bcrypt password hashing, JWT issuance, duplicate-email
  rejection, wrong-password rejection, missing-field validation — all
  confirmed via live HTTP calls against the real DB.
- Full hand lifecycle over HTTP: preflop → flop → turn → river → showdown,
  with fold/check/call/raise all exercised, run 4× with different random
  deals — chip conservation held every time (sum of net results across
  players == 0, total table chips == total buy-ins, before and after).
- Side-pot construction: tested a short stack going all-in against two
  deeper stacks who kept betting past that point. The short stack's loss was
  correctly capped at their stack size; the side pot the short stack wasn't
  eligible for was awarded to the two players who covered it. Chip
  conservation held.
- Stripe key handling: `services/payments/stripeService.js` and
  `achService.js` already read the secret key from `process.env.STRIPE_API_KEY`
  — never hardcoded. Left as-is; see chat for why the key you pasted needs to
  be rotated and only goes in environment config, never in a file.

## Explicitly NOT tested/fixed this pass (out of scope for this zip)

- Live Stripe API calls: this sandbox has no network path to
  `api.stripe.com`, so `/wallet/deposit` was not exercised against a real
  Stripe test-mode PaymentIntent. Code inspection shows the plumbing is
  correct; live testing needs to happen from an environment with Stripe
  network access (your dev machine or CI).
- Frontend (sign-in landing page/redirect, cashgame-demo's Hand/Pot/Fairness
  Proof table markup, any React changes) — not in this zip. Needs the
  frontend repo.
- `services/game/wsAuth.js` / live websocket table lookups — read through
  fully, found already correctly fixed (the README's own "known gap" note
  about `CashGameTable.findOne(db, {...})` turned out to already be written
  correctly with the right Sequelize signature). No change needed.

## 2026-09-04 — Known-gap remediation pass

- Fixed the active `KYCManager.getLimits()` defect. `KYCManager` now exposes a configuration-backed `getLimits()` implementation, and `LimitChecker.checkDeposit()` validates amounts and fails closed when the KYC deposit-limit policy is missing or invalid. Numeric tier thresholds are intentionally not hardcoded because the supplied specification/source does not define a regulatory policy.
- Closed the wallet authorization gap by requiring a user JWT on user-owned balance, transaction, deposit, withdrawal, crypto deposit, and Stripe Connect routes, and by rejecting any `user_id` that does not match the authenticated identity.
- Added `GET /wallet/deposit-status`, exposing the existing provider status refresh path for a single transaction while enforcing user ownership at the payment-record query.
- Added `POST /admin/change-password`, requiring the authenticated admin's current password and a 12-character minimum new password.
- Updated OpenAPI security declarations and route documentation for the new/secured surfaces.
- Added focused Node test coverage for the KYC limit policy and admin password hashing.
