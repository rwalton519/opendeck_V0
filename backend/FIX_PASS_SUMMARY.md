# Fix pass summary — 2026-08-12

Covers the 4 requested items. Full detail for each is in the files linked below; this is
just the map.

## 1. Wire RNG into live dealing
**Status: already done, not a gap.** `services/game/liveHandEngine.js` already wires
`services/rng/deckService.js`'s commit/shuffle/cut/reveal pipeline into real per-hand live
cash-game dealing, and is called from `api/routes/cashgameRouter.js`. Verified by reading
both files end-to-end — no code change was needed. Documented as item 9 in
`CHANGELOG_FIXES.md` so this doesn't get re-flagged as a gap later.

## 2. Consolidate data models — tournament tables merged
**Status: done, tested against a live database.** Removed `GameTournament`
(`services/game/models/tournamentModels.js`), a second, parallel, JSONB-blob tournament
model that had no relationship to the real `Tournament`/`TournamentRegistration` model — a
player registering via the REST API and one registering via a live WebSocket event landed
in two disconnected records, which also caused a standing bug in `eliminatePlayer` (looked
up a registration using the wrong table's id space).

- `tournamentManager.js`, `buyinManager.js`, `settlementManager.js`, `stateManager.js`
  rewritten onto the single `Tournament`/`TournamentRegistration` model.
- `RakeManager`'s dead, self-flagged-as-superseded settlement methods removed along with the
  last references to `GameTournament`.
- New migration `1745000800000_tournament-model-consolidation.js` drops the now-unused
  `game_tournaments` table.
- **Verified live**: ran all 8 migrations against a real Postgres instance, seeded demo data,
  registered/settled/eliminated a player through the live-event `TournamentManager` path, and
  confirmed the exact same row shows up correctly through the REST `GET /tournaments/:id`
  endpoint (`total_players`/`players_remaining` reflect the live-event mutation).

Full writeup: `MIGRATIONS.md` → "Tournament model consolidation", `CHANGELOG_FIXES.md` → item
10.

## 3. Stripe Elements/Connect frontend screens
**Status: done, delivered separately** (this zip is backend-only; there's no frontend
checked in here to add to). See the sibling deliverable `stripe_frontend_screens/` — two
real React/TypeScript components (`CardDepositForm.tsx`, `PayoutOnboarding.tsx`) built
against this backend's actual contract (`docs/DEPOSIT_CARD_PAYMENT_CONTRACT.md`,
`routers/walletStripeConnect.js`), with only the Stripe publishable key and a couple of
redirect URLs left as placeholders — everything else is working code, not scaffolding.
`stripe_frontend_screens/README.md` has integration steps for your existing frontend at
`D:\projects\web_app_v2\frontend`.

## 4. Deployment artifacts
**Status: done, tested end-to-end.**
- `Dockerfile` (Node 22, runs migrations then starts the server) + `docker-compose.yml`
  (backend + Postgres 16, healthchecked, plus an opt-in `seed` profile) + `.dockerignore`.
- `db/seed.js` — idempotent demo-data seed script (4 users with wallet balances, a cash
  table, tournaments in WAITING/RUNNING/FINISHED states). Guards against running against
  anything that doesn't look like a local database. `npm run seed`.
- `docs/api/openapi.yaml` — OpenAPI 3.0 spec, all ~56 mounted routes. Served live at
  `GET /docs` (Swagger UI) and `GET /docs/openapi.yaml`.
- `docs/api/OpenDeck.postman_collection.json` + `.postman_environment.json` — generated
  directly from the OpenAPI spec via `openapi-to-postmanv2`, so the two can't drift apart.
- **Verified live**: installed dependencies, ran migrations against a real Postgres, ran the
  seed script, booted the actual server (not a stub), confirmed `GET /docs`,
  `GET /docs/openapi.yaml`, `GET /`, and `GET /tournaments` all respond correctly.

## What's genuinely still open (not silently glossed over)
- The Postman collection's auth is manual (set `adminToken` after calling `/admin/login`
  yourself) — no pre-request script auto-refreshes it.
- Docker images aren't published anywhere (no registry push) — `docker compose up --build`
  builds locally.
- `docs/api/openapi.yaml`'s admin dashboard/tooling endpoints have lighter schemas (summary +
  auth only) than the money-movement endpoints — noted directly in `docs/api/README.md`.
