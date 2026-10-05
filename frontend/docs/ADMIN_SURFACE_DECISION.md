# Admin surface consolidation (spec v3.0, issue 7.1)

## The problem

Two independent admin frontends existed side by side:

1. **React SPA routes** — `/admin/login` (`AdminLoginPage`) and
   `/admin/withdrawals` (`AdminWithdrawalQueuePage`, gated by
   `RequireAdmin`), built from `src/`, part of the main bundle.
2. **A standalone static dashboard** — `dist/admin/index.html`, a
   hand-built, self-contained HTML/JS app with its own login form, served
   directly by nginx at `/admin/`.

Both called the same backend `/admin/*` endpoints (`POST /admin/login`,
`GET/POST /admin/withdrawals/*`) using two unrelated codebases with no
shared session, components, or design system. The static dashboard also
covered `/admin/dashboard/summary`, `/ledger`, `/accounts`, and
`/fraud-flags` — surfaces the React app never had any UI for at all.

## The decision

**The static dashboard at `/admin/` is the canonical admin surface.**

Rationale: it was already the more feature-complete implementation
(accounting ledger, fraud review queue, account/IP management, *and*
withdrawal approval — the React side only ever covered the last one), and
building equivalent React UI for the ledger/accounts/fraud-flags surfaces
to reach parity would have been substantially more work than retiring the
smaller, duplicate half.

## What changed

- Removed: `src/pages/AdminLoginPage/`, `src/pages/AdminWithdrawalQueuePage/`,
  `src/components/routing/RequireAdmin.tsx`, `src/context/AdminAuthContext.tsx`,
  `src/hooks/useAdminAuth.ts`, `src/api/admin.ts`.
- Removed: `AdminAuthProvider` from `main.tsx`, the "Admin" nav link and
  "Admin Sign Out" button from `AppShell.tsx`, `adminApiClient` and
  `ADMIN_AUTH_EXPIRED_EVENT` from `api/client.ts`, `adminAuthTokenStorageKey`
  from `config/env.ts`.
- Added: `src/components/routing/AdminRedirect.tsx` — `/admin/login` and
  `/admin/withdrawals` still exist as routes, but now only perform a hard
  browser redirect (`window.location.replace`, not React Router's
  `Navigate`) to `/admin/`, so old bookmarks or links land on the real
  dashboard instead of the SPA's 404 page. A hard redirect is required
  here specifically because `/admin/` is a real static file nginx serves,
  not a route this SPA can render internally.

## What did not change

- The backend's `/admin/*` routes and `requireAdmin` middleware are
  untouched — this was a frontend consolidation only.
- The static dashboard itself (`dist/admin/index.html`) was not modified.
- Regular user auth (`AuthContext`, `tp_auth_token`) is unaffected.

## Follow-up (out of scope here, tracked separately)

If the static dashboard is ever rebuilt as a proper source-controlled app
(rather than a single hand-authored HTML file), consider whether it should
become a React module under this same repo for a unified toolchain — that
is a larger decision than this cleanup and was intentionally not made here.
