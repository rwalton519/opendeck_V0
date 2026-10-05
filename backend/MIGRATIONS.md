# Migrations

This directory is the schema source of truth as of this fix pass. Run with:

```
npm run migrate:up
npm run migrate:down   # to revert the most recent migration
npm run migrate:create <name>   # to scaffold a new one
```

## Why this history was rebuilt

The migration files that originally shipped in this repo (`1745000000000_initial-schema.js`
and `1745100000000_tournament-expansion.js`) were a direct, as-is conversion of a stale
Alembic history from an earlier version of the Python backend. They created a `users`
table with a UUID primary key and a `password_hash` column, plus `wallets` / `transactions`
tables under those exact names — none of which match the Sequelize models this application
has actually been running (`models/user.js` uses an integer auto-increment `id` and a
`password` column; the real wallet tables are `wallet_balance` / `wallet_transactions`).
Running those migrations against a fresh database would have produced a schema the
application immediately fails against.

Because of that mismatch, the application was relying entirely on `Sequelize.sync()` at
boot (see `db/syncModels.js`) to create/alter tables directly from the live model
definitions. That's a reasonable development bootstrap, but not an acceptable strategy for
a database holding real user funds — `sync({ alter: true })` isn't guaranteed safe against
destructive changes, and it leaves no reviewable, revertible record of what changed.

This directory now contains a fresh migration history, hand-written to match every current
model file column-for-column:

| Migration | Mirrors |
|---|---|
| `1745000000000_users-and-admins.js` | `models/user.js`, `models/admin.js` |
| `1745000100000_wallet-and-payments.js` | `models/real_money.js`, `models/payment_models.js` |
| `1745000200000_tournaments.js` | `models/tournament.js`, `models/ticket.js` |
| `1745000300000_cashgame-and-hands.js` | `services/game/models/tableModels.js`, `services/game/models/handModels.js`, `models/hand_history.js` |
| `1745000400000_compliance-and-kyc.js` | `models/compliance_models.js`, `models/collusion_flag.js`, `models/kyc_models.js` |
| `1745000500000_user-account-controls.js` | Adds `users.is_frozen`, new in this fix pass (backs `POST /admin/freeze_user` / `unfreeze_user`) |
| `1745000600000_games-rng.js` | `models/game.js` (provably-fair commit/reveal games, backs `services/rng/deckService.js`) |
| `1745000700000_admin-dashboard.js` | Admin Dashboard: IP tracking columns, fraud review / ledger support |
| `1745000800000_tournament-model-consolidation.js` | Drops `game_tournaments` (see "Tournament model consolidation" below) |

`db/syncModels.js` no longer runs `sync({ alter: true })` by default — it now just verifies
connectivity and that migrations have been applied, and fails loudly at boot if the `users`
table is missing. `sync()` is still available as an explicit, clearly-logged opt-in via
`DB_SYNC_ALTER=true`, intended for quickly standing up a scratch database in local
development only.

## Tournament model consolidation (`1745000800000_tournament-model-consolidation.js`)

`1745000200000_tournaments.js` originally created **two** separate, parallel tournament
data models in the same migration:

- `tournaments` / `tournament_registrations` / `tournament_tables` — typed, relational,
  backing `models/tournament.js`. This is what `routers/tournaments.js` (the REST API) and
  `scheduler/tournamentScheduler.js` (auto blind-level advance, table balancing, payouts)
  have always read and written.
- `game_tournaments` — a single JSONB `players` blob, backing the now-removed
  `services/game/models/tournamentModels.js` (`GameTournament`). This was read/written by
  the WebSocket-event-driven live-play path (`services/game/tournamentManager.js`,
  `buyinManager.js`, `settlementManager.js`, dispatched via `eventDispatcher.js`).

These were never actually the same tournament record: a player registering through the
REST API and one registering through a live WebSocket event landed in two entirely
disconnected rows, with no relationship between a `tournaments.id` and a
`game_tournaments.id`. `services/game/tournamentManager.js`'s `eliminatePlayer` had a
standing, previously-flagged bug as a direct consequence — it looked up a
`TournamentRegistration` using a `GameTournament.id`, a different table's id space, so the
lookup only coincidentally succeeded when the two ids happened to match.

**Fix:** `GameTournament` is gone. Every consumer (`tournamentManager.js`, `buyinManager.js`,
`settlementManager.js`, `stateManager.js`) now operates on the single canonical `Tournament`
model, with per-player chip stacks living on `TournamentRegistration.stack` — already the
field the REST API and scheduler used — instead of a separate JSONB dict. There is now
exactly one tournament record per tournament, and exactly one place a player's chip stack
lives, regardless of whether the mutation came in through the REST API or a live WebSocket
event.

`1745000800000_tournament-model-consolidation.js` drops the now-unused `game_tournaments`
table. It had no foreign keys pointing into it from any other table, so the drop carries no
orphaned-reference risk.

## Going forward

Any change to a model file (`models/*.js`, `services/game/models/*.js`) should be paired
with a corresponding migration in this directory in the same change, the same way you'd
pair a code change with a test. `db/syncModels.js`'s boot-time check will catch a missing
migration (no `users` table) but won't catch a migration that's out of sync with a model in
some other way — that's on code review.
