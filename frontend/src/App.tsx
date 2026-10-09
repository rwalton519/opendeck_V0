import { Suspense, lazy } from "react";
import { Routes, Route } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { HomePage } from "./pages/HomePage/HomePage";
import { PageStub } from "./components/ui/PageStub";
import { AdminRedirect } from "./components/routing/AdminRedirect";

// FIXED (landing page blank / oversized bundle): every route used to be a
// static top-level import here, so React Router pulled ALL of them (and
// everything they import) into the one entry chunk that loads on every
// single page - including "/". Several of these pages (RegisterPage via
// PrivyWalletActivation, WalletPage via PolygonWalletCard, CryptoDepositPage,
// CashGameTablePage, BacktestPage) statically import "@privy-io/react-auth"
// and "viem/chains", which alone add >1.7MB (min) to that one entry chunk -
// see the `npm run build` chunk-size warning. Only HomePage and the always-
// mounted AppShell chrome stay as static imports; every other route is now
// React.lazy()'d into its own chunk that's fetched only when that route is
// actually visited. This also means a landing-page visitor never even
// downloads/evaluates the wallet SDKs, so a startup issue in that dependency
// graph can no longer blank out "/" - see PrivyProviders.tsx /
// PrivyWalletLinkContext.tsx for the existing isPrivyConfigured() guards on
// top of this.
//
// Pages export named components (not `export default`), so each lazy()
// import maps the named export to the `default` React.lazy expects.
const WalletPage = lazy(() => import("./pages/WalletPage/WalletPage").then((m) => ({ default: m.WalletPage })));
const MyTicketsPage = lazy(() =>
  import("./pages/MyTicketsPage/MyTicketsPage").then((m) => ({ default: m.MyTicketsPage })),
);
const TournamentLobbyPage = lazy(() =>
  import("./pages/TournamentLobbyPage/TournamentLobbyPage").then((m) => ({ default: m.TournamentLobbyPage })),
);
const TournamentDetailPage = lazy(() =>
  import("./pages/TournamentDetailPage/TournamentDetailPage").then((m) => ({ default: m.TournamentDetailPage })),
);
const TournamentTablePage = lazy(() =>
  import("./pages/TournamentTablePage/TournamentTablePage").then((m) => ({ default: m.TournamentTablePage })),
);
const CryptoDepositPage = lazy(() =>
  import("./pages/CryptoDepositPage/CryptoDepositPage").then((m) => ({ default: m.CryptoDepositPage })),
);
const WithdrawPage = lazy(() =>
  import("./pages/WithdrawPage/WithdrawPage").then((m) => ({ default: m.WithdrawPage })),
);
const CashGameTablePage = lazy(() =>
  import("./pages/CashGameTablePage/CashGameTablePage").then((m) => ({ default: m.CashGameTablePage })),
);
const CashGameLobbyPage = lazy(() =>
  import("./pages/CashGameLobbyPage/CashGameLobbyPage").then((m) => ({ default: m.CashGameLobbyPage })),
);
const RegisterPage = lazy(() =>
  import("./pages/RegisterPage/RegisterPage").then((m) => ({ default: m.RegisterPage })),
);
const LoginPage = lazy(() => import("./pages/LoginPage/LoginPage").then((m) => ({ default: m.LoginPage })));
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const SideBetPage = lazy(() => import("./pages/SideBetPage/SideBetPage").then((m) => ({ default: m.SideBetPage })));
const AboutPage = lazy(() => import("./pages/AboutPage/AboutPage").then((m) => ({ default: m.AboutPage })));
const CareersPage = lazy(() =>
  import("./pages/CareersPage/CareersPage").then((m) => ({ default: m.CareersPage })),
);
const LegalPage = lazy(() => import("./pages/LegalPage/LegalPage").then((m) => ({ default: m.LegalPage })));
const LivePage = lazy(() => import("./pages/LivePage/LivePage").then((m) => ({ default: m.LivePage })));
const DemosPage = lazy(() => import("./pages/DemosPage/DemosPage").then((m) => ({ default: m.DemosPage })));

function RouteFallback() {
  // Deliberately minimal - this only ever flashes briefly while a route
  // chunk downloads on navigation, never on initial load of "/".
  return <PageStub title="Loading…" note="" />;
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Standalone Authentication Views (No AppShell wrapping) */}
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />

        {/* FIXED (spec v3.0, issue 7.1): /admin/login and /admin/withdrawals
            used to render this SPA's own admin surface (AdminLoginPage,
            AdminWithdrawalQueuePage). That surface has been retired in favor
            of the more complete static dashboard nginx already serves at
            /admin/ (dist/admin/index.html) - see AdminRedirect.tsx. These two
            routes now only exist to bounce old bookmarks/links there via a
            real browser navigation instead of 404ing on the SPA's catch-all. */}
        <Route path="/admin/login" element={<AdminRedirect />} />
        <Route path="/admin/withdrawals" element={<AdminRedirect />} />

        {/* Protected Application Routes inside App Context */}
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          {/* Screener pages: "/" = LIVE | DEMO, "/live" = CASH GAMES | TOURNAMENTS,
              "/demos" = the three no-account demo pages. */}
          <Route path="/live" element={<LivePage />} />
          <Route path="/demos" element={<DemosPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/sidebet-sim" element={<SideBetPage />} />
          <Route path="/withdraw" element={<WithdrawPage />} />
          <Route path="/tickets" element={<MyTicketsPage />} />
          <Route path="/tournaments" element={<TournamentLobbyPage />} />

          {/* Site info pages */}
          <Route path="/about" element={<AboutPage />} />
          <Route path="/careers" element={<CareersPage />} />
          <Route path="/legal" element={<LegalPage />} />

          {/* Tournaments & Tables */}
          <Route path="/tournaments/:tournamentId" element={<TournamentDetailPage />} />
          <Route path="/tournaments/:tournamentId/table" element={<TournamentTablePage />} />

          {/* Crypto */}
          <Route path="/crypto-deposit/:asset" element={<CryptoDepositPage />} />

          {/* Cash Game Module Layout - :tableId is optional; CashGameTablePage
              defaults to DEFAULT_CASH_TABLE_ID when it's absent, so plain
              /cash-game keeps working exactly as before. */}
          {/* /cash-games (plural) = lobby of numbered tables. Table 1 -> /cash-game,
              Tables 2..N -> /cash-game/table-N (see CashGameLobbyPage/cashTables.ts). */}
          <Route path="/cash-games" element={<CashGameLobbyPage />} />
          <Route path="/cash-game" element={<CashGameTablePage />} />
          <Route path="/cash-game/:tableId" element={<CashGameTablePage />} />

          {/* Provably-fair hand backtesting (/backtest) is excluded from
              this public version - it is part of the proprietary shuffle
              protocol. See frontend/src/lib/fairness/README.md. */}

          {/* Catch-all 404 handler */}
          <Route
            path="*"
            element={<PageStub title="Route not found" note="This path isn't in the routing table." />}
          />
        </Route>
      </Routes>
    </Suspense>
  );
}
