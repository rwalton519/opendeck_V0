# Frontend fixes applied this pass — 2026-08-24

Verified against the real backend (backend.zip, with the Sequelize/minRaise
fixes from the previous pass) - not stubs. Full production build (`npm run
build`), typecheck (`tsc -b`), and lint (`oxlint`) all clean. The client-side
fairness verifier was run against a hand actually played out over the real
HTTP API and correctly returned `verified: true`, then correctly returned
`verified: false` when the same record was deliberately tampered with (see
chat for the raw output of both runs).

## Item 1: real sign-in wired into "+ Take Seat"

`CashGameTablePage.tsx`'s seat button used to just set an inline error
("Sign in to take a seat.") and stop when clicked while signed out. It now
navigates to `/register?redirect=<current table path>`.

- `RegisterPage.tsx`: on successful `POST /auth/register`, immediately calls
  `POST /auth/login` with the same credentials (register doesn't return a
  session token, only login does) and navigates straight to the `redirect`
  target. Falls back to a manual "Go to Login" button only if that
  auto-login call itself fails (e.g. future email-verification requirement)
  - the account still exists either way.
- `LoginPage.tsx`: reads the same `?redirect=` param and navigates there
  post-login instead of always going to `/`. Falls back to `/` if absent
  (unchanged default behavior for direct /login visits).
- Both pages pass the `redirect` param through their "Log In" / "Create
  one" cross-links so it survives switching between them.

Net effect: click "+ Take Seat" signed out → land on account creation →
account is created and immediately logged in → back at the exact same
table, ready to take the seat again. No dead ends.

## Item 2: Stripe

`services/payments/stripeService.js`/`achService.js` (backend) and
`src/config/env.ts` / `CardDepositForm.tsx` (frontend) already read the key
from environment variables (`STRIPE_API_KEY` server-side, `VITE_STRIPE_
PUBLISHABLE_KEY` client-side via `.env.production`, which is intentionally
committed *blank* with a comment explaining why). No code changes needed
here, and no key is hardcoded anywhere in this deliverable. See chat for
why the key you pasted needs rotating and why I couldn't live-test a real
charge from this sandbox (no network path to api.stripe.com).

## Item 3: bet/call/raise on flop/turn/river

Already covered by the backend pass. On the frontend, the raise `<input>`
used to guess the minimum legal raise as `currentBet + 1` (and its
suggested default as `currentBet + bigBlind`) because the backend never
sent the real value. Now that `getPublicState()` sends `minRaise` (backend
fix from last pass), `CashHandState` and `normalizeHandState()` were
updated to carry it through, and the raise input's `min` / default now use
the real server-enforced value - confirmed against a live hand's actual
`minRaise` field name and value over HTTP (`"minRaise": 2` on a $1/$2
table, exact camelCase match, no normalization fallback needed).

## Item 4: Hand/Pot/Table Info + Fairness Proof panels

Added two panels below the table canvas, structured the same way as
`public/cashgame-demo/index.html`'s `.below-table` panels (same labels:
"Hand/Pot/Table Info" grid, "Fairness Proof" with deck-commit-while-live →
reveal-seed-once-complete → "Verified ✓" once independently checked):

- **Hand/Pot/Table Info**: table id, blinds, hand number, street, pot,
  current bet, and min raise.
- **Fairness Proof**: while a hand is live, shows that hand's deck commit
  hash (server can't reveal the seed yet without giving away undealt
  cards). Once the hand completes, fetches `GET /cashgame/:tableId/
  last-hand` (via the already-existing `fairnessApi`, previously only used
  by `BacktestPage`) and shows the commit hash + revealed seed, with a
  "Verify this hand" button that runs `verifyLiveHand()` - the same
  from-scratch client-side shuffle reconstruction `BacktestPage`'s "live"
  mode uses - rather than trusting a server-reported flag. Links out to the
  full backtest breakdown for anyone who wants the play-by-play.

## Explicitly NOT tested this pass

- Real click-through in an actual browser: this sandbox has no network path
  to download a headless-browser binary (Chromium etc.), so I could not
  drive the UI with real clicks. What I *did* verify: `tsc -b` and
  `npm run build` both succeed cleanly, `oxlint` reports 0 errors/warnings
  on every file I touched, the built bundle actually contains the new
  redirect/minRaise logic (grepped the output JS), all routes return 200
  from a served production build, the exact backend JSON field names match
  what the frontend normalizers expect (checked byte-for-byte over HTTP),
  and the fairness verifier's actual crypto logic was run standalone
  against a real completed hand and correctly passed/failed as expected.
  Recommend a manual click-through (or Playwright/Cypress in an environment
  with browser-download access) before shipping, as a final check on things
  a type-checker can't catch - visual layout, CSS, exact click targets.

## Item 5: landing page blank / demo tabs restored

Fixed the startup crash that could leave `opendeck.ca` showing a blank page when
`VITE_PRIVY_APP_ID` is intentionally unset. `PrivyWalletLinkProvider` now uses
an outer component that checks `isPrivyConfigured()` before rendering the
hook-using inner provider. This prevents `usePrivy()` / `useWallets()` from
running outside a `<PrivyProvider>` in deployments where Privy is disabled.

Restored the three standalone demo links on the landing page as canonical
absolute URLs so they continue to leave the SPA and resolve directly to the
public static demos:

- `https://opendeck.ca/cashgame-demo`
- `https://opendeck.ca/heads-up`
- `https://opendeck.ca/RNG-shuffle-tester`

The existing behavior of opening those standalone demos in a separate browser
tab is preserved.

### Verification

- TypeScript/JSX transpile parsing passed for both touched files.
- Confirmed the three canonical demo URLs are present in `HomePage.tsx`.
- A full production build could not be completed in this sandbox because the
  uploaded dependency tree is incomplete/broken (`@privy-io/react-auth` and
  `viem/chains` are absent, and Vite's native Rolldown binding is missing).
