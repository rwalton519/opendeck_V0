# Frontend fixes - round 3 (2026-09-07)

## The bug report: "Cash Game Demo (and probably every other link) shows a red error"

Verified end-to-end with headless Chromium against a local server replicating
the corrected nginx config, plus a stub backend. Root cause, and everything
that came out of chasing it down:

### 1. Root cause - not a frontend bug: nginx has no `location /webapp/` block

Every API call in the app - all three homepage demo games, login, register,
wallet, tournaments, the real cash table - is built as
`${location.origin}/webapp/...` (see `src/config/env.ts`). Production nginx
has no proxy for that path at all, so every one of those requests falls
through to the SPA's `index.html`, fails to parse as JSON, and surfaces as
red text (`--color-danger`) like *"Couldn't reach the demo table backend."*
That's the reported error, and it explains "probably every other link" too -
one missing block, not many separate bugs. Already diagnosed in
`docs/NGINX_WEBAPP_ROUTING.md`, apparently never applied. This one needs a
server-side change - see `deploy/nginx/opendeck-webapp.conf` (new file, ready
to paste in) and re-run `scripts/verify-webapp-routing.sh` against production
once applied.

### 2. Real frontend bug found along the way: Heads Up demo was broken beyond seating

`public/heads-up/index.html` unconditionally sets `$('handLine').textContent`
on every state update, but no element with `id="handLine"` existed anywhere
in the file - the HUD block was never added when this page was built from
the Cash Game Demo template (the CSS for it, `.meta-text` / `.meta-text
.hand-line`, was already there and unused - just the HTML was missing). This
threw an uncaught error inside `render()`, silently aborting every render
step after it: pot, community cards, hole cards, fairness panel, and betting
controls never updated once you joined and got seated.

**Fix**: added the missing `<div class="meta-text">` HUD block to
`public/heads-up/index.html` (and synced to `dist/heads-up/index.html`).
Verified via headless test: hand-line and pot now render correctly after
joining and taking a seat.

### 3. Related, previously-undocumented gap: `/sidebet-api/` has the same problem as #1

`env.ts`'s `sideBetApiBaseUrl` points at `/sidebet-api`, served by a
*separate* Node process from the main backend (`.env.example`:
`VITE_SIDEBET_API_BASE_URL=http://localhost:4000` locally, vs. the main
backend's `8000`). Same missing-nginx-proxy problem, just not yet reported
since nothing on the homepage links to `/sidebet` today. Added to
`deploy/nginx/opendeck-webapp.conf` and `docs/NGINX_WEBAPP_ROUTING.md`.

### 4. Related gap: no-trailing-slash redirects only covered `/cashgame-demo`

The other two static demo games, `/heads-up` and `/RNG-shuffle-tester`, are
in the identical `try_files $uri $uri/ /index.html;` situation and need the
same redirect. Added to `deploy/nginx/opendeck-webapp.conf`.

### 5. Cleanup: dead code and a stray file found during the audit

- `src/components/PayoutOnboarding.tsx` - unused/unreferenced anywhere in the
  app (the real, integrated payout-setup flow is `src/components/wallet/PayoutSetup.tsx`),
  and its own hardcoded redirect URLs (`/wallet/payouts/onboarding-complete`,
  `/wallet/payouts/onboarding-refresh`) don't correspond to any registered
  route. Removed, along with `src/README1.md`, the delivery note for
  integrating it into a *different* project that was never actually acted on
  in this repo.
- `public/cashgame-demo/index.html.backup-before-chip-fix.html` - a backup
  file that was shipping to production as a publicly-accessible URL. Removed
  from both `public/` and `dist/`.
- `README.md`'s "Cash Game Demo" section still described it as "entirely
  client-side... doesn't call this project's API," which is no longer true
  and was actively misleading while diagnosing #1 above. Left the historical
  section in place but added a correction note pointing at what's actually
  true today.

## Verification

Headless Chromium (Playwright) driven against two local setups:
- The real, unmodified `dist/` behind a server replicating the *fixed*
  nginx config (proxy + redirects) - homepage links, all three demo games
  (join/seat/deal), and SPA route resolution: **24/24 checks passed**.
- A locally origin-patched copy of the same build (API origin rewritten to
  a local test server, since production's is hardcoded to `opendeck.ca` at
  build time and can't reach this sandbox) against a stub backend - register,
  login, wallet, tournaments, sidebet, and the full "Take Seat while logged
  out -> register -> dashboard -> back to table -> seat auto-claimed" round
  trip: **16/16 checks passed**.

## Files in this package
- `public/heads-up/index.html`, `dist/heads-up/index.html` (patched)
- `public/cashgame-demo/index.html.backup-before-chip-fix.html`,
  `dist/cashgame-demo/index.html.backup-before-chip-fix.html` (removed)
- `src/components/PayoutOnboarding.tsx`, `src/README1.md` (removed)
- `deploy/nginx/opendeck-webapp.conf` (new - apply this on the server)
- `docs/NGINX_WEBAPP_ROUTING.md`, `scripts/verify-webapp-routing.sh`,
  `README.md` (docs updated to match)

---



## What was actually broken

Your build failure and the still-present INVALID_ANNOTATION spam were two
separate, unrelated things - neither was caused by the App.tsx/lazy-loading
changes from the previous round. Both are fixed by the 3 files here.

### 1. The real build breakage: `npm audit fix --force`

I'd explicitly recommended against this, but `package.json`/`package-lock.json`
in the zip you sent back had `@privy-io/react-auth` loosened to `^3.6.1`
(the version the earlier `npm audit --force` warning threatened). The caret
range meant `npm install` didn't actually install 3.6.1 - it resolved to the
*newest* 3.x, `3.40.0`, which is actually newer than the `3.38.0` you were
running before.

That newer version is what broke the build. I reproduced it in my sandbox:
`3.40.0` pulls in a Solana wallet-funding code path that references exports
from `@solana/kit`/`@solana-program/system` that aren't resolvable in this
dependency tree, and the build hard-fails with 26 `[MISSING_EXPORT]` errors -
a real, build-blocking bug, not a cosmetic warning.

**Fix**: `package.json` now pins `"@privy-io/react-auth": "3.38.0"` exactly
(no caret) - the version you were running when the site last worked -
and `package-lock.json` is regenerated to match. Pinning without a caret
matters here: a caret range lets a future `npm install` silently pull a
newer 3.x again and reintroduce this.

### 2. INVALID_ANNOTATION still printing: my earlier vite.config.ts fix never made it in

I gave you this fix last time, but the `vite.config.ts` in the zip you just
sent back was still the untouched original - it didn't have the
`checks.invalidAnnotation: false` change. Easy to lose track of one file
among many edits; it's back in this package.

## Files in this package
- `package.json` (overwrite)
- `package-lock.json` (overwrite - regenerated fresh against the pinned
  Privy version, don't hand-edit this one)
- `vite.config.ts` (overwrite)

## Verified
In my sandbox, with these 3 files applied on top of the App.tsx /
PrivyProviders.tsx / PrivyWalletLinkContext.tsx changes from last round
(which I re-checked and confirmed came through correctly on your end):

```
rm -rf node_modules package-lock.json   # skip if using the package-lock.json above
npm install --legacy-peer-deps
npm run build
```

- `tsc -b`: 0 errors
- `vite build`: succeeds, 0 INVALID_ANNOTATION lines, 0 chunk-size warnings
- Entry chunk (`index-*.js` referenced by `<script>` in dist/index.html):
  196KB - down from 1.7MB before the App.tsx route-splitting fix, confirming
  that fix is intact and doing its job.

## What I still can't verify from here
Real click-through in an actual browser (no headless browser binary
available in this sandbox) - please do a manual pass after deploying this.
Also worth double-checking your CI/deploy step isn't running a bare
`npm audit fix` or `--force` automatically at any point, since that's what
introduced the regression this round.

## Live / Demo screener pages
- `/` (HomePage) is now a screener: two large gold-glow tiles, LIVE and DEMO.
- `/live` (new LivePage): CASH GAMES -> `/cash-game`, TOURNAMENTS -> `/tournaments`.
- `/demos` (new DemosPage): Cash Game Demo (`/cashgame-demo/`), Heads Up (Demo) (`/heads-up/`),
  Random Shuffle Test Table (`/RNG-shuffle-tester/`). These are static pages in `public/`, so they
  use real browser navigation (`<a href>`), not react-router `<Link>`.
- Shared `components/ui/ScreenerTiles` (+ CSS module) renders all three screens.
- Nav: added "Live" and "Demos" links. Removed unused `HomePage.module.css`.
- No nginx change needed: `/live` and `/demos` are SPA routes handled by the existing `try_files` fallback.
