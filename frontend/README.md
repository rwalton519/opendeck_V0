opendeck
Opendeck project folder

# "Set up payouts" flow — frontend patch

Wires the two new backend endpoints (`POST /wallet/stripe-connect/onboard`,
`GET /wallet/stripe-connect/status`) into the wallet page. 5 modified files,
2 new files — apply by copying these into the matching paths under
`frontend_new/src/`.

## New files

- **`components/wallet/PayoutSetup.tsx`** + **`.module.css`** — the actual
  UI. Renders on the wallet page as its own panel: checks payout status on
  load, shows "✓ Payouts enabled" if done, otherwise a "Set Up Payouts"
  button that redirects to Stripe's hosted onboarding. No card/bank data is
  collected in this app at all — that entire step happens on Stripe's own
  page, which is the point of using Connect.

## Modified files

- **`pages/WalletPage/WalletPage.tsx`** — one addition: renders
  `<PayoutSetup />` between the balance card and the deposit form.
- **`api/wallet.ts`** — two new functions, `startPayoutOnboarding()` and
  `getPayoutStatus()`, following the same normalization pattern already
  used for every other call in this file.
- **`types/wallet.ts`** — two new types (`PayoutOnboardingResult`,
  `PayoutStatus`) for the above.
- **`api/auth.ts`** + **`context/AuthContext.tsx`** — see below, this was
  the one real gap that needed fixing to make onboarding possible at all.

## The gap this surfaced: `AuthContext` never stored the user's email

Creating a Stripe Connect account needs an email, but `AuthContext` only
ever stored `userId` — even though your backend's real `/auth/login`
response already includes `email`, it was being silently discarded
(`normalizeLoginResponse` only ever read `token` and `user_id`/`userId`/`id`).

Fixed by extending `LoginResponse` to also capture `email`, and
`AuthContext` to store and expose it (persisted in `localStorage` under
`tp_user_email`, mirroring how `userId` is already handled). `PayoutSetup`
reads it via `useAuth().email`.

**Edge case handled**: if someone has an existing session from before this
change (only `tp_user_id` in localStorage, no `tp_user_email`), clicking
"Set Up Payouts" shows "Please log in again to set up payouts" instead of
sending a request the backend would reject — rather than silently failing
or crashing.

## How the redirect flow works

1. User clicks "Set Up Payouts" → `startPayoutOnboarding(userId, email, pageUrl, pageUrl)`
   is called, where `pageUrl` is the current wallet page's own URL (used as
   both `refresh_url` and `return_url` — Stripe sends the user back to
   whichever applies: `return_url` on completion, `refresh_url` if the link
   itself expired before they finished).
2. Browser is redirected (`window.location.href = result.url`) to Stripe's
   hosted onboarding page. Nothing else happens in this app until Stripe
   sends the user back.
3. Stripe redirects back to the wallet page. `PayoutSetup` re-checks status
   on every mount (a normal page load), so no special return-URL query
   param handling was needed — it just reflects whatever Stripe's actual
   account state is now.

## Testing without a real Stripe account

`GET /wallet/stripe-connect/status?user_id=X` returns
`{onboarded: false, payouts_enabled: false, ...}` for any user with no
connected account yet — that's the default state you'll see before doing
anything. Clicking through onboarding requires the backend's
`STRIPE_API_KEY` to be a real (test-mode is fine) Stripe key; Stripe's test
mode lets you complete the whole flow with fake ID/bank details.

## Cash Game Demo — /cashgame-demo

A no-login, play-money demo table lives at `public/cashgame-demo/index.html`,
served the same way `public/sidebet-sim/index.html` already is: Vite copies
everything under `public/` verbatim into the build output, so this becomes
a static file at `/cashgame-demo/` with no React route, no build step, and
no backend involved. Linked from the "Cash Game Demo" card on the home
page (`HomePage.tsx`), which opens it in a new tab via a plain `<a
target="_blank">` rather than a router `<Link>`, since it isn't part of
the SPA.

**What it is:** a 9-seat table using the production `CashGameTablePage`
seat layout/coordinates and the production `TournamentTablePage` fairness
panel styling, running the same HMAC-SHA256-seeded Fisher-Yates
commit/reveal shuffle described for the real table, entirely client-side.
$1/$2 blinds, $500 starting stacks, click a vacant seat to sit down (no
buy-in prompt — the amount is fixed). Two seeded logins (Adam, Ach) plus
an open invite link that lets anyone claim a unique username, all with the
same $500 stack. Three house seats play automatically so the table isn't
empty on a fresh visit.

**What it is not:** connected to anything else. It doesn't call this
project's API, doesn't share sessions with `/cash-game` or the real login,
and doesn't persist or sync between browser tabs — each tab is an
independent, private simulation. There are no betting rounds or folding;
every dealt hand runs straight to showdown. This is intentional (a demo of
the seating flow and the fairness mechanism, not a full poker engine) but
worth knowing before pointing anyone at it expecting real multiplayer
behavior.

> **Update, since the above was written:** `public/cashgame-demo/index.html`
> (and the `/heads-up` and `/RNG-shuffle-tester` pages that followed it) were
> rearchitected to talk to a real backend - `DEMO_API_BASE` in each file
> POSTs to `${location.origin}/webapp/<demo-name>/...` and opens an SSE
> stream for live state, with real betting actions (fold/check/call/bet/
> raise). The "entirely client-side, no backend involved" description above
> is no longer accurate; leaving it in place rather than rewriting history,
> but flagging it here since it was the misleading trail that made this
> bug harder to diagnose than it should have been - see
> `docs/NGINX_WEBAPP_ROUTING.md`.

### Deployment note: `opendeck.ca/cashgame-demo` (and `/heads-up`, `/RNG-shuffle-tester`) need a static route

Vite's build output puts this at `dist/cashgame-demo/index.html`. Whether
`https://opendeck.ca/cashgame-demo` (no trailing slash) resolves depends
on the web server in front of the built site:

- If nginx (or similar) serves the built `dist/` with a rule like
  `try_files $uri $uri/ /index.html;` (the usual SPA fallback), a request
  for `/cashgame-demo` **without** a trailing slash will not match the
  directory and will fall through to the SPA's `index.html` instead of
  this demo. `/cashgame-demo/` (with the slash) will resolve correctly,
  since `$uri/` matches the directory and finds its `index.html`.
- To make the no-slash form work too, add an explicit redirect ahead of
  the SPA fallback, e.g. for nginx:
  ```nginx
  location = /cashgame-demo { return 301 /cashgame-demo/; }
  ```
- The other two static demo games on the home page - `/heads-up` and
  `/RNG-shuffle-tester` - are in the exact same situation and need the
  same treatment.
- This is the same situation `/sidebet-sim` is already in; if that one
  already works without a trailing slash in production, the same rule
  covers the other three too. Not something this change can fix from the
  frontend side — it's a server-config item, called out rather than
  silently assumed.
- A ready-to-paste nginx fragment covering all three (plus the separate,
  more serious `/webapp/` proxy gap that was actually breaking these demo
  pages end-to-end - see `docs/NGINX_WEBAPP_ROUTING.md`) lives at
  `deploy/nginx/opendeck-webapp.conf`.


# Transparent Poker — React Port

React (Vite + TypeScript) port of the original Flutter app, in progress.
Delivered module by module; this drop is the **scaffold + core module**:
project setup, routing, theming, and the API/auth foundation every other
module builds on. Wallet, tournaments, and the live table land in
follow-up messages.

## Run it

```bash
npm install
npm run dev
```

Then open the printed local URL (typically http://localhost:5173).

Works the same way on Windows 11 ARM64: Node.js ships an ARM64 Windows
build, and everything here is pure JS/TS with no native (node-gyp)
dependencies, so `npm install` needs no build tools.

## Configuring the backend

There is exactly **one** place backend hosts are named — the three
conflicting hardcoded URLs from the Flutter source (`ApiClient`,
`AppConfig`, `TournamentService`) have been collapsed into this:

```bash
cp .env.example .env.local
# edit .env.local
```

```
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_BASE_URL=ws://localhost:8000
```

Swapping the Python backend for Node.js later is a change to these two
values, not to any component or service file. The REST client
(`src/api/client.ts`) also doesn't assume any particular backend
framework's error-response shape (it reads `detail` / `message` / `error`,
covering both FastAPI-style and typical Node/Express-style error bodies).

## What's in this drop

```
src/
  api/
    client.ts       generic REST wrapper (auth header, JSON, typed errors)
    auth.ts          login/logout, normalizes backend response shape
  config/
    env.ts           single source of truth for API/WS base URLs
  context/
    AuthContext.tsx  replaces the hardcoded "demo-user" / userId: 1
                     literals scattered through the original screens
  hooks/
    useAuth.ts
  components/
    layout/AppShell  persistent nav (the original just had a button
                     list on the home screen and no way back except
                     the browser's back button)
    ui/Button, GlassPanel, PageStub
  pages/
    HomePage          real content
    (7 other pages)    stubs for now — filled in by later modules
  styles/
    tokens.css, global.css   the design system
```

## Known fixes vs. the Flutter source (applied silently, per your call)

- Collapsed 3 conflicting backend base URLs into 1 env-driven config.
- `/withdraw` and `/crypto-deposit` no longer both point at a screen that
  required `asset`/`depositAddress` params neither route supplied —
  Withdraw now has its own page, and deposit takes `:asset` as a route
  param.
- Tournament detail/table routes now take real path params
  (`/tournaments/:tournamentId`) instead of relying on a tournament id
  that no caller ever passed in.
- User identity now comes from one `AuthContext` instead of a different
  hardcoded literal per screen.
- The two divergent copies of `PaymentMethodType` / `PaymentResult` /
  `WalletTransaction` (one set in `models/`, a second in
  `services/payment_service.dart`, with different enum member names)
  will be unified into one set of types in the wallet module.

## Wallet module (this drop)

```
src/
  types/wallet.ts     unified PaymentMethodType / PaymentResult / WalletTransaction
  api/wallet.ts        deposit, withdraw, balance, transactions, admin queue,
                        crypto deposit address + status
  pages/
    WalletPage          balance, deposit form, filterable transaction history
    WithdrawPage         dedicated withdraw form (see fix below)
    CryptoDepositPage    QR code + address + live confirmation polling
    AdminWithdrawalQueuePage   approve/reject pending withdrawals
```

Fixes applied in this module:

- **Unified `PaymentMethodType`.** The Flutter source had two independent
  enums with different member names (`models/payment_method_type.dart`:
  `creditCard | debitCard | paypal | crypto`, vs. an unused, richer one
  in `services/payment_service.dart`: `card | debit | bankTransfer |
  eTransfer | eWallet | square | cryptoBtc | cryptoEth | cryptoMonero |
  cryptoOther | inAppPurchase`). The richer, unused one became the single
  definition in `src/types/wallet.ts` — it's the more complete real-world
  option list and the only one that accounts for e-Transfer.
- **"Payout History" no longer opens the admin queue.** In the original,
  a *regular user's* Wallet screen had a button that navigated straight
  into `AdminWithdrawalQueueScreen` — the admin approve/reject panel.
  That's replaced with an All/Deposits/Withdrawals filter on the same
  transaction list, which is what that button was almost certainly meant
  to do.
- **Crypto deposit is real now.** `CryptoDepositScreen` in the original
  required an `asset` and `depositAddress` as constructor params that no
  route ever supplied, and "confirmation" was a local 3-tick `Timer` with
  no backend call at all. `CryptoDepositPage` now fetches a real address
  from `/wallet/crypto-deposit-address` and polls
  `/wallet/crypto-deposit-status` — both clearly marked as endpoints the
  backend still needs to implement; until then the page shows a real
  error state instead of faking a confirmation.
- **`/withdraw` is a real page**, not an alias for the deposit screen.

## Tournaments module (this drop)

```
src/
  types/tournament.ts   Tournament, Ticket
  api/tournaments.ts     fetchTournaments, fetchTournament, register,
                          fetchTableState, rebuy, addon, fetchUserTickets
  pages/
    TournamentLobbyPage    list + register (see fix below)
    TournamentDetailPage    single tournament + join
    MyTicketsPage            a user's tickets (see fix below)
```

Fixes applied in this module:

- **The `/tournament-lobby` route bug.** `TournamentLobbyScreen` had a
  required `userId` constructor parameter, but `main.dart`'s route
  registered it with none — `const TournamentLobbyScreen()` — which
  would fail to compile/crash depending on how strictly it's called.
  `TournamentLobbyPage` now reads `userId` from the same `AuthContext`
  every other page uses, so the route itself needs no param.
- **`MyTicketsScreen`'s hardcoded `userId: 1`.** `main.dart` passed a
  literal `MyTicketsScreen(userId: 1)` — every user would have seen
  user 1's tickets. `MyTicketsPage` now uses the authenticated user.
- **A fourth hardcoded backend host, folded in.** `MyTicketsScreen` had
  its own hardcoded `https://soverraai.ca:8000` (a *third* host,
  distinct from the two already unified in the scaffold module) baked
  directly into an `http.get` call. It now goes through the same
  `apiClient` / `VITE_API_BASE_URL` as everything else.
- **Join now goes to the right table.** The original's "Join Tournament"
  always navigated to a fixed `/tournament-table` route with no id, so
  it could never actually know which tournament's table to load.
  `TournamentDetailPage` now navigates to `/tournaments/:id/table`.
- **`rebuy` / `addon`** are ported into `tournamentsApi` (they existed in
  `TournamentService` but were never wired to any screen in the
  original) — no UI surfaces them yet since none did before; they're
  natural candidates for the live-table module next.

A note on backend inconsistencies: some of what looked like "bugs" above
(divergent field names, a nested `current_blinds` object next to flat
snake_case fields elsewhere, three-to-four different hardcoded hosts) are
really *frontend* symptoms of a backend that was itself inconsistent —
likely because it was assembled in pieces, possibly by different people or
across the Python→Node transition already partway in someone's head. Since
the real backend doesn't exist in this repo, every normalization above
lives in exactly one place per resource (`normalizeTournament`,
`normalizeTicket`, `normalizeTransaction`, `normalizePendingWithdrawal` in
their respective `api/*.ts` files) specifically so that whatever shape the
eventual Node backend actually returns, adapting to it is a one-function
edit — not a hunt through every page component.

## Design direction

Dark felt-and-brass casino palette, with the original app's one genuinely
distinctive element — the frosted-glass, green-monospace RNG readout —
generalized into a reusable "glass panel" used for verified/technical
data throughout (wallet balances, fairness proofs, admin queues).


