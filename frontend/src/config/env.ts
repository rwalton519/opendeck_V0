/**
 * Central runtime configuration.
 *
 * The original Flutter app hardcoded THREE different backend hosts across
 * three different files (ApiClient -> https://api.soverraai.ca,
 * AppConfig -> http://10.0.2.2:8000, TournamentService -> a literal
 * "YOUR_BACKEND_HOST" placeholder, MyTicketsScreen -> yet another host).
 * This file is the single source of truth going forward.
 *
 * Every value is overridable via .env / .env.local without touching code,
 * which is what makes swapping the Python backend for a Node backend later
 * a config change instead of a code change.
 */

function readEnv(key: string, fallback: string): string {
  const value = import.meta.env[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export const env = {
  /**
   * Base URL for all REST calls, e.g. https://api.example.com (no trailing slash).
   * Overridable via VITE_API_BASE_URL, same as wsBaseUrl below - falls back to the
   * production host so behavior is unchanged unless the env var is actually set.
   */
  apiBaseUrl: readEnv("VITE_API_BASE_URL", "https://opendeck.ca/webapp"),

  /** Separate SideBet service; it is never used for poker-wallet payments. */
  sideBetApiBaseUrl: readEnv("VITE_SIDEBET_API_BASE_URL", "https://opendeck.ca/sidebet-api").replace(/\/+$/, ""),

  /**
   * Base URL for a live-table WebSocket, e.g. wss://api.example.com.
   * NOTE: not currently consumed by any code path. The generic WS
   * "/realtime" channel contract this used to back (src/ws/socket.ts) was
   * removed - it depended on a backend endpoint that was never actually
   * implemented (see REALTIME_CONTRACT.md). Retained here, unused, in case
   * a real backend WebSocket for live tables is implemented later; nothing
   * currently reads this value.
   */
  wsBaseUrl: readEnv("VITE_WS_BASE_URL", "ws://localhost:8000").replace(/\/+$/, ""),

  /** localStorage key used to persist the regular user auth token (web equivalent of SharedPreferences) */
  authTokenStorageKey: "tp_auth_token",

  // FIXED (spec v3.0, issue 7.1): adminAuthTokenStorageKey ("tp_admin_token")
  // has been removed along with the rest of this SPA's admin surface - see
  // src/components/routing/AdminRedirect.tsx. The canonical admin dashboard
  // now lives entirely outside this app at /admin/ and manages its own
  // session there.

  /** Stripe publishable key (safe to expose client-side). Empty string if unset. */
  stripePublishableKey: readEnv("VITE_STRIPE_PUBLISHABLE_KEY", ""),

  // ADDED (USDC/Polygon integration) - see src/config/chain.ts, which reads
  // these through this same `env` object rather than import.meta.env
  // directly, keeping the "one source of truth" property this file exists
  // for.
  /** Polygon chain id: 137 = mainnet, 80002 = Amoy testnet. */
  polygonChainId: Number(readEnv("VITE_POLYGON_CHAIN_ID", "137")),
  /** Deployed OpenDeckPoker.sol address (see backend contracts/deploy.js). Empty until deployed. */
  openDeckPokerContractAddress: readEnv("VITE_OPENDECK_POKER_CONTRACT_ADDRESS", ""),
  /** Native USDC on Polygon - verify against Circle's published address for whatever chain id is actually configured. */
  usdcAddress: readEnv("VITE_USDC_ADDRESS", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"),

  // ADDED (Privy embedded-wallet integration) - see src/providers/PrivyProviders.tsx.
  /** Privy's public App ID (safe to expose client-side). Empty until configured. */
  privyAppId: readEnv("VITE_PRIVY_APP_ID", ""),
} as const;

/**
 * Guards against the exact failure mode that used to be silent: a missing,
 * or still-test-mode, Stripe key baked into a *production* build. Building
 * with `vite build --mode production` (npm run build) sets import.meta.env.PROD;
 * in that case an empty or pk_test_ key is almost certainly a deploy-config
 * mistake, not an intentional test build, so callers should refuse to
 * proceed rather than let Stripe fail confusingly at payment-confirmation
 * time. Dev/preview builds are left alone, since pk_test_ is exactly right
 * there.
 */
/** Whether Privy embedded-wallet auto-creation is configured for this build -
 * PrivyProviders.tsx and usePrivyWalletLink both no-op rather than throwing
 * when this is false, so a deployment without a Privy App ID set just skips
 * the feature instead of crashing the whole app. */
export function isPrivyConfigured(): boolean {
  return env.privyAppId.length > 0;
}

export function getStripeKeyIssue(): string | null {
  const key = env.stripePublishableKey;
  if (!import.meta.env.PROD) return null;
  if (!key) {
    return "Stripe is not configured for this build (VITE_STRIPE_PUBLISHABLE_KEY is unset). Card deposits are unavailable until a live key is set.";
  }
  if (key.startsWith("pk_test_")) {
    return "This production build is configured with a Stripe TEST-mode key. Card deposits will be rejected by Stripe until a live (pk_live_...) key is set.";
  }
  return null;
}
