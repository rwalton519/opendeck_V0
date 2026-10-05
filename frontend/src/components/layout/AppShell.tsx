import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import styles from "./AppShell.module.css";

const baseLinks = [
  { to: "/", label: "Home", end: true },
  { to: "/about", label: "About" },
  { to: "/careers", label: "Careers" },
  { to: "/legal", label: "Legal" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/wallet", label: "Wallet" },
  { to: "/sidebet-sim", label: "SideBet" },
  { to: "/tickets", label: "My Tickets" },
  { to: "/live", label: "Live" },
  { to: "/demos", label: "Demos" },
  { to: "/tournaments", label: "Tournaments" },
];

/**
 * FIXED (spec v3.0, issue 7.1): this used to show/hide an "Admin" nav link
 * and an "Admin Sign Out" button based on useAdminAuth().isAdminAuthenticated,
 * pointing at this SPA's own /admin/withdrawals route. That route (and the
 * whole React-side admin surface behind it) has been retired in favor of
 * the static dashboard at /admin/ - see AdminRedirect.tsx and
 * docs/ADMIN_SURFACE_DECISION.md. Regular users of this shell never had an
 * admin session to begin with, so there's nothing to conditionally show
 * here anymore; admins now go directly to /admin/ instead of through this
 * nav.
 */
export function AppShell() {
  const { isAuthenticated, logout } = useAuth();

  // Note: the actual Privy embedded-wallet auto-link effect runs once,
  // app-wide, in PrivyWalletLinkProvider (mounted in main.tsx) - not here.
  // Components that need the live status (e.g. PolygonWalletCard on
  // WalletPage) read it via hooks/usePrivyWalletLink.ts.

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <a
  	 href="https://opendeck.ca"
  	 className={styles.brand}
  	 style={{ textDecoration: "none", color: "inherit" }}
	 >
  	 <span className={styles.brandMark}>♠</span>
  	 <span>Transparent Poker</span>
	</a>
        <nav className={styles.nav}>
          {baseLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => (isActive ? `${styles.link} ${styles.linkActive}` : styles.link)}
            >
              {link.label}
            </NavLink>
          ))}
          {isAuthenticated ? (
            <button type="button" className={styles.link} onClick={logout}>
              Sign Out
            </button>
          ) : (
            <NavLink
              to="/login"
              className={({ isActive }) => (isActive ? `${styles.link} ${styles.linkActive}` : styles.link)}
            >
              Sign In
            </NavLink>
          )}
        </nav>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
