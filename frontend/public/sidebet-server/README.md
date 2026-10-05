# SideBet — Backend

Node.js / Express / PostgreSQL API for the SideBet peer-to-peer, skill-based
prediction market described in the technical spec. This implements the
"Pass 2" architecture from the spec (real database, real money-movement
ledger) with the security and integrity gaps called out in that spec's
§5 and §6 closed:

| Spec gap | Fixed here |
|---|---|
| Raw string interpolation into SQL | Every query is parameterized (`$1, $2, ...`) |
| Hardcoded JWT secret / no real auth on money routes | JWT auth (`Authorization: Bearer <token>`) required on every route that moves money |
| Hardcoded lock/payout amounts (100 / 200) | Stake comes from the request and drives every ledger entry |
| No insufficient-balance check | Checked and rejected with 409 before any lock |
| No ownership checks (self-accept, double-accept) | Enforced in `/accept` |
| No transactional wrapping | Every money-moving route runs inside a single DB transaction (`BEGIN`/`COMMIT`/`ROLLBACK`) |
| Race conditions on concurrent accept/settle | Row-level locks (`SELECT ... FOR UPDATE`) serialize concurrent requests against the same user/prediction |
| No outcome authority | Not solved (still explicitly out of scope) — but no longer trusts a single caller either; see below |

**Still out of scope**, same as the spec: real payment rails, KYC/AML,
production deployment/scaling, and a real dispute-resolution process for
when two participants disagree about who won.

## Outcome authority — what changed vs. "not implemented"

The spec flagged "who decides the winner" as not started. Rather than fake
an oracle, this backend requires **both participants to independently
agree**: each calls `POST /predictions/:id/result` with who they think won.
If they agree, funds settle automatically. If they disagree, the market
moves to `DISPUTED` and stays there with funds locked — there's no
resolution path yet, but no unilateral payout either. Wiring in a real
dispute process (admin review, arbitration, timeouts) is the natural next
step and is intentionally left as a seam, not solved here.

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# edit .env — set DATABASE_URL and a real JWT_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. Create the database (once), then run the migration
#    createdb sidebet    # or create it via psql/pgAdmin
npm run migrate

# 4. (Optional) seed two demo users with $1000 each
npm run seed

# 5. Start the server
npm start          # or: npm run dev  (auto-restarts on file changes)
```

The server refuses to start if `DATABASE_URL` or `JWT_SECRET` are missing,
rather than falling back to insecure defaults.

`npm run migrate` applies numbered SQL files and records each one in
`schema_migrations`; it does not depend on schema sync during application
startup. The integrity migration adds database-level guards for one `LOCK`
per participant/market and one `PAYOUT` per market, closing the remaining
durable double-settlement path even if a request is retried.

## API reference

All request/response bodies are JSON. Money routes require
`Authorization: Bearer <token>` from `/auth/login` or `/auth/register`.

### Auth

| Method & path | Body | Notes |
|---|---|---|
| `POST /auth/register` | `{ email, password }` | Password min 8 chars. Returns `{ token, user }`. New users start with balance 1000 (schema default). |
| `POST /auth/login` | `{ email, password }` | Returns `{ token, user }`. |

### Current user

| Method & path | Auth | Notes |
|---|---|---|
| `GET /users/me` | required | Profile + balances. |
| `GET /users/me/transactions?limit=50` | required | Your ledger, newest first. |

### Predictions (markets)

| Method & path | Auth | Body | Notes |
|---|---|---|---|
| `POST /predictions` | required | `{ title, odds?, stake }` | Creates an `OPEN` market and locks `stake` from your balance. |
| `GET /predictions?status=&limit=` | none | — | List markets, newest first. |
| `GET /predictions/:id` | none | — | Single market detail. |
| `POST /predictions/:id/accept` | required | — | Locks `stake` from you, market becomes `MATCHED`. Fails if it's your own market, already matched, etc. |
| `POST /predictions/:id/cancel` | required | — | Creator-only, `OPEN`-only. Releases the locked stake. |
| `POST /predictions/:id/result` | required | `{ winnerId }` | Either participant reports a result. Settles automatically once both agree; `DISPUTED` if they don't. |

### Example flow

```bash
# Register two users
curl -s -X POST localhost:4000/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"a@example.com","password":"password123"}'
curl -s -X POST localhost:4000/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"b@example.com","password":"password123"}'
# -> save each token as TOKEN_A / TOKEN_B

# A creates a market
curl -s -X POST localhost:4000/predictions -H "Authorization: Bearer $TOKEN_A" \
  -H 'Content-Type: application/json' \
  -d '{"title":"I break 80 Saturday","odds":"1:1","stake":100}'
# -> save the returned id as PRED_ID

# B accepts it
curl -s -X POST localhost:4000/predictions/$PRED_ID/accept -H "Authorization: Bearer $TOKEN_B"

# Both report the same winner -> auto-settles
curl -s -X POST localhost:4000/predictions/$PRED_ID/result -H "Authorization: Bearer $TOKEN_A" \
  -H 'Content-Type: application/json' -d "{\"winnerId\":\"$USER_A_ID\"}"
curl -s -X POST localhost:4000/predictions/$PRED_ID/result -H "Authorization: Bearer $TOKEN_B" \
  -H 'Content-Type: application/json' -d "{\"winnerId\":\"$USER_A_ID\"}"

# Verify the ledger
curl -s localhost:4000/users/me/transactions -H "Authorization: Bearer $TOKEN_A"
```

## Project layout

```
src/
  index.js                  Express app + startup
  db/
    schema.sql               Table definitions
    migrate.js                Applies schema.sql
    seed.js                   Optional demo users
    pool.js                    pg Pool + withTransaction() helper
  middleware/
    auth.js                    Verifies Bearer JWT -> req.user
    errorHandler.js            Central error -> JSON response mapping
  routes/
    auth.routes.js              /auth/register, /auth/login
    users.routes.js             /users/me, /users/me/transactions
    predictions.routes.js       /predictions/*
  services/
    ledger.js                   lockFunds / releaseFunds / settle — all
                                 balance + transaction-row writes go through
                                 here so money movement has one code path
  utils/
    AppError.js                 Typed errors with an HTTP status
    validate.js                  Input validation helpers
    jwt.js                        Sign/verify helpers
```
