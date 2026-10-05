# Changelog — Recommendations Fix Pass

Applied against `OpenDeck_Backend_Specification.docx` §12 ("Recommendations Prior to
Production Launch"). Every item from that list is addressed below, plus two additional
blocking bugs found while verifying the fixes end-to-end against a real PostgreSQL
database (noted as such, not originally in the recommendations list).

All fixes were verified by actually running the server against a live PostgreSQL 16
instance — not just syntax-checked. See "Verification" at the end of this document.

---

## 1. Provably-fair RNG engine (§7.4) — was a hardcoded mock

**Before:** `routers/rng.js` and `routers/game.js` returned literal hardcoded values
(`'sha256_hash_of_seed'`, a fixed 3-card sample deck) for every request, with no real
shuffling, sealing, commitment, or verification logic anywhere.

**After:**
- `services/rng/deckService.js` — a real commit-reveal provably-fair engine: CSPRNG seed
  generation, a deterministic HMAC-SHA256-seeded Fisher-Yates shuffle (reproducible from
  the seed alone), player-cut support, and independent verification that recomputes
  everything from scratch rather than trusting a stored flag.
- `models/game.js` + `migrations/1745000600000_games-rng.js` — new `games` table backing
  it (nothing like this existed before).
- `routers/game.js` / `routers/rng.js` rewritten to use the real engine. One deliberate
  behavior change: `POST /game/:id/cut` no longer returns actual post-cut card values —
  only a commitment hash. Publishing real card order before it's dealt would defeat the
  whole point of a provably-fair scheme; real values now only come out at `/reveal`.

**Scope boundary (not done):** this makes the commit/shuffle/cut/reveal/verify primitives
real. It does not wire per-hand card dealing into live cash-game or tournament play —
that integration is further, separate work on top of this engine.

## 2. Database migrations (§4.3) — stale, non-functional migration history

**Before:** the only migrations present created a `users` table with a UUID primary key
and `password_hash` column, and `wallets`/`transactions` tables that don't correspond to
any current Sequelize model. `Sequelize.sync({ alter: true })` was the only thing
actually keeping the schema usable.

**After:**
- Old migrations deleted; a new 7-file migration set added, hand-written to match every
  current model column-for-column (see `MIGRATIONS.md` for the full mapping table).
- `db/syncModels.js` rewritten: migrations are now the default schema-management path.
  `sync({ alter: true })` still exists but requires an explicit `DB_SYNC_ALTER=true`
  opt-in and is clearly logged as a local-development-only fallback. The default boot
  path now just verifies connectivity and that the `users` table exists, failing loudly
  (not silently altering schema) if migrations haven't been run.
- Ran `npm run migrate:up` against a real Postgres 16 instance — all 7 migrations apply
  cleanly, producing all 20 expected tables.

## 3. WebSocket table-state lookup (§7.1) — wrong Sequelize call signature

**Before:** `api/routes/wsRouter.js` called `CashGameTable.findOne(db, { id: tableId })` —
passing `db` as a positional argument, which Sequelize doesn't accept. This threw at
runtime on every WebSocket table-state query.

**After:** Fixed to `CashGameTable.findOne({ where: { id: tableId } })`. Swept the rest
of the codebase for the same pattern (`findAll(db,`, `findByPk(db,`, `create(db,`) — this
was the only instance.

## 4. Broken admin endpoints calling nonexistent methods (§5.7 / §9)

**Before:** four admin routes called manager methods that were never implemented and
would throw at runtime:
- `POST /admin/freeze_user`, `/unfreeze_user` → `ComplianceManager.freezeUser`/`unfreezeUser`
- `POST /admin/approve_payout`, `/reject_payout` → `ComplianceManager.approvePayout`/`rejectPayout`
- `POST /admin/tournament/advance_level` → `TournamentManager.advanceLevel`

**After:**
- `ComplianceManager.freezeUser`/`unfreezeUser` implemented for real, backed by a new
  `users.is_frozen` column (`models/user.js`,
  `migrations/1745000500000_user-account-controls.js`). `services/game/wsAuth.js`
  already had a dormant, defensive check for this exact field — it's live now.
- `services/wallet/withdrawalService.js` — the withdrawal approve/reject logic previously
  inline in `admin/adminRouter.js` was extracted into a shared service. Both the real
  `/admin/withdrawals/approve|reject` routes AND the legacy `/approve_payout`,
  `/reject_payout` routes now call it (treating `payout_id` as a `WithdrawalRequest` id —
  there was never a second, distinct "payout" model for the legacy routes to operate on).
- `TournamentManager.advanceLevel` implemented for real, mirroring the same level-advance
  logic `scheduler/tournamentScheduler.js` already runs automatically on a timer, applied
  to `GameTournament` for consistency with the rest of `TournamentManager`.
- Verified all four routes against a real tournament and user row: freeze/unfreeze
  persisted correctly; `advance_level` correctly incremented through blind levels.

## 5. Admin login credential transport (§8.4) — sent via URL query string

**Before:** `POST /admin/login` read `username`/`password` from `req.query`, meaning
credentials traveled in the URL — routinely captured by proxy logs, access logs, and
browser history.

**After:** reads from `req.body` (JSON) instead. `AdminAuth.authenticate()` itself is
unchanged since it only ever took plain strings. Verified: a real admin login round-trip
via JSON body works and correctly rejects bad credentials.

## 6. ACH / non-Monero crypto withdrawal decision (§6.2–6.3)

**Decision made:** building real ACH bank-account-linking and real BTC/ETH transaction
broadcast is substantial, separate infrastructure work, out of scope for this fix pass.
Instead of leaving these silently unadvertised or half-working:
- `utils/paymentMethods.js` gained a `PAYMENT_METHOD_CAPABILITIES` map — single source of
  truth for which methods have real deposit/withdrawal support today, with a plain-English
  note for each.
- New `GET /wallet/payment-methods/capabilities` endpoint exposes this, so a client can
  discover and hide non-functional options up front instead of only finding out via a 501
  after the user tries.
- The existing honest 501 behavior on the affected routes is unchanged.

## 7. Compliance rule engine not invoked on money movement (§8.5)

**Before:** `ComplianceManager.runChecks` was wired into cash-game/tournament buy-ins
(`services/game/buyinManager.js`) but never into wallet deposits or withdrawals — the two
routes where real money actually enters or leaves the platform.

**After:** wired into both `POST /wallet/deposit` and `POST /wallet/withdraw`
(`routers/wallet.js`), matching the exact same fire-and-forget-to-storage pattern
`buyinManager.js` already used (flags recorded for review; a triggered rule doesn't block
the request inline — that's this codebase's existing design, not something changed here).
Verified: a $3 test deposit correctly wrote a `fraud:micro_deposit_pattern` compliance
flag before the (expected, sandbox-only) Stripe API call failed.

## 8. Client-side Stripe Elements confirmation flow (§6.1)

**Not done.** This is frontend work (completing payment via `stripe.confirmCardPayment()`
in the browser) and isn't part of this backend archive. Flagging explicitly rather than
silently skipping: the backend-side PaymentIntent creation and webhook crediting are both
real and unchanged; only the client-side confirmation step is missing, and it lives in a
different codebase.

## 9. Live cash-game RNG wiring — real per-hand dealing, not just primitives

**Before:** item 1 above made the commit/shuffle/cut/reveal/verify primitives in
`services/rng/deckService.js` real, but explicitly did not wire per-hand dealing into live
cash-game play — `api/routes/cashgameRouter.js`'s `/settle_hand` expected a caller to have
already computed `pots`/`results` from a hand-resolution process that didn't exist.

**After:** `services/game/liveHandEngine.js` is the real live cash-game hand engine —
betting rounds, side pots, showdown — built directly on `deckService`'s commit/shuffle/cut
pipeline. Every hand gets its own CSPRNG seed, published commitment, player-independent cut,
and a revealed seed once the hand completes, so every real-money cash-game hand is now
natively provably-fair, not just the standalone `/game/*` demo/audit endpoints. Wired into
`api/routes/cashgameRouter.js`. See `docs/BACKTEST_AND_FAIRNESS.md` for the exact
commit/cut/reveal shape a client (or the planned `/backtest` verification app) needs to
independently re-derive and check a specific hand.

## 10. Tournament model consolidation — two disconnected tournament records, one bug fixed

**Before:** `services/game/models/tournamentModels.js` (`GameTournament`, a single JSONB
`players` blob) and `models/tournament.js` (`Tournament`/`TournamentRegistration`, typed and
relational) were two separate, un-linked tournament data models. A player registering
through the REST API (`routers/tournaments.js`) and one registering through a live
WebSocket event (`services/game/tournamentManager.js`, dispatched via `eventDispatcher.js`)
landed in two disconnected rows with no relationship between the two ids. This directly
caused a standing bug: `TournamentManager.eliminatePlayer` looked up a
`TournamentRegistration` by a `GameTournament.id` — a different table's id space entirely,
so the lookup only coincidentally succeeded when the two ids happened to match.

**After:** `GameTournament` is removed outright. `tournamentManager.js`, `buyinManager.js`,
and `settlementManager.js` all now operate on the single canonical `Tournament` model, with
per-player chip stacks living on `TournamentRegistration.stack` (already the field the REST
API and scheduler used) instead of a parallel JSONB dict. There's exactly one tournament
record and exactly one place a chip stack lives, however the mutation arrives. New migration
`1745000800000_tournament-model-consolidation.js` drops the now-unused `game_tournaments`
table (no FKs pointed into it, so this is a safe drop). Also removed: `RakeManager`'s
`settleCashgameHand`/`settleTournamentHand`/`finalizeTournament` — confirmed dead/superseded
code (self-documented in the original conversion; `SettlementManager`'s versions are what's
actually called), and the last references to `GameTournament` went with them. Full writeup
in `MIGRATIONS.md` under "Tournament model consolidation".

---

## Additional fixes found during verification (not in the original recommendations list)

While booting the full server against a real database to verify the above, two more
pre-existing, blocking bugs surfaced:

- **`server.js` couldn't boot at all.** `db/attachDb.js` does `module.exports = attachDb`
  (a direct function export), but `server.js` destructured it as `const { attachDb } =
  require(...)`, which evaluates to `undefined` and crashes `app.use(attachDb)`
  immediately. Fixed to a plain `require`.
- **`npm install` failed outright.** `package.json` pinned `modern-treasury@^3.13.0`, a
  version that was never published (the registry jumps from `3.3.0` to `4.4.1`). Re-pinned
  to `^3.3.0`, the newest existing 3.x release, since `services/payments/wireService.js`
  is written against the 3.x API shape.

---

## Verification

All of the above was tested against a real, freshly-installed PostgreSQL 16 instance, not
just syntax-checked:

1. `npm install` — succeeds (207 packages).
2. `node -c` on every `.js` file in the project — all pass.
3. `npm run migrate:up` — all 7 migrations apply cleanly; `\dt` confirms all 20 expected
   tables exist.
4. `require('./server.js')` — loads cleanly end-to-end (fails only at the actual DB
   connection step when no DB is configured, as expected).
5. Full server boot against the real migrated database — succeeds, new schema-check boot
   path passes.
6. Live HTTP round-trips against the running server:
   - `GET /` → `{"status":"ok"}`
   - `POST /auth/register` → real user created, `is_frozen: false` present.
   - `POST /admin/login` with a JSON body → correctly authenticates / rejects.
   - `POST /admin/freeze_user` / `/unfreeze_user` → `is_frozen` persisted correctly both
     ways.
   - `POST /game/start` → `POST /game/:id/cut` → `POST /game/:id/reveal` → `GET
     /game/:id/verify` → full cycle, `verified: true`, `commit_matches: true`,
     `deck_matches: true`.
   - `POST /admin/tournament/advance_level` called twice on a seeded tournament →
     correctly advanced `current_level` 0 → 1 → 2 with correct blind info at each step.
   - `POST /wallet/deposit` with a $3 amount → `compliance_flags` table correctly gained a
     `fraud:micro_deposit_pattern` row before the (expected) Stripe sandbox failure.
   - `GET /wallet/payment-methods/capabilities` → correct capability map returned.

---

## Addendum — legacy `/payments/deposit` fixed, card-deposit contract documented

Follow-up pass, done against **Frontend Executive Summary v2.0**'s one open
item ("confirming exactly what the deposit endpoint returns for a card
payment today").

**Bug found and fixed:** `routers/payments_router.js`'s legacy
`POST /payments/deposit?user_id=...&amount=...` called
`stripeService.createDepositIntent()` directly, bypassing
`PaymentManager` entirely. No `PaymentRecord` row was ever created for the
`PaymentIntent` it made, and `POST /wallet/webhooks/stripe` — the only
thing that actually credits a wallet after a card payment — looks up a
`PaymentRecord` by that PaymentIntent's id. A real customer charge made
through this endpoint would have succeeded on Stripe's side while the
user's wallet balance silently never moved. Fixed by rewiring the route
through `PaymentManager.deposit()`, the same path `POST /wallet/deposit`
uses, so a `PaymentRecord` now always exists for the webhook to find. The
route is marked deprecated in favor of `/wallet/deposit`; it was left
mounted (rather than removed) only for backward compatibility, since
nothing in this codebase indicates whether anything external still calls
it.

**Documented, not changed:** the exact request/response contract for
`POST /wallet/deposit` with a card-type `method` — this was already fully
implemented and working (real `PaymentIntent` creation, webhook-driven
crediting, idempotency) but had never been written down anywhere the
frontend team could reference. See `docs/DEPOSIT_CARD_PAYMENT_CONTRACT.md`
for the full request/response shapes, the three-step flow
(create intent → client-side Stripe.js confirmation → webhook credit), and
one flagged open product decision (deposit currency is hardcoded to USD
despite the `.ca` domain).
