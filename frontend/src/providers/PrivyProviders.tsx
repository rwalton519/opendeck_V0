import { Suspense, lazy, type ReactNode } from "react";
import { isPrivyConfigured } from "../config/env";

// FIXED (landing page blank / oversized entry bundle): this file used to
// statically import "@privy-io/react-auth" and "viem/chains" at the top,
// so that ~1.7MB (min) landed in the app's ONE entry chunk - mounted here in
// main.tsx, on every single route including "/" - regardless of whether
// VITE_PRIVY_APP_ID was even set. The actual PrivyProvider JSX now lives in
// ConfiguredPrivyProviders.tsx, loaded via React.lazy() so that chunk is
// only fetched, parsed, and executed when Privy is actually configured.
// An unconfigured deployment (the current opendeck.ca default - see
// .env.production) now never touches that dependency graph at all, which
// also removes it as a possible source of a startup crash blanking the
// landing page before React can render anything.
const ConfiguredPrivyProviders = lazy(() => import("./ConfiguredPrivyProviders"));

/**
 * Wires the app up to Privy for embedded-wallet auto-creation on email
 * login/registration.
 *
 * - loginMethods: ['email'] - Privy's own email OTP flow is the identity
 *   this wallet is tied to (see hooks/usePrivyEmailWallet.ts, which drives
 *   that flow headlessly from RegisterPage/LoginPage rather than Privy's
 *   default modal, so it fits inline into the existing username/password
 *   forms instead of replacing them).
 * - embeddedWallets.ethereum.createOnLogin: 'users-without-wallets' - every
 *   player who authenticates via email and doesn't already have a wallet
 *   gets one created automatically; players who bring their own (MetaMask,
 *   linked via src/lib/blockchain/browserWallet.ts) are left alone.
 * - defaultChain/supportedChains follow the SAME VITE_POLYGON_CHAIN_ID that
 *   already governs src/config/chain.ts (mainnet 137 vs. Amoy testnet
 *   80002), so this can't drift out of sync with the rest of the app's
 *   on-chain config by pointing Privy at one network while the contract/USDC
 *   config in chain.ts point at another.
 * - The wallet itself is just an EVM keypair - "USDC denomination" is a
 *   display/interaction concern, not a wallet setting - see
 *   hooks/usePrivyWalletLink.ts and lib/blockchain/browserWallet.ts's
 *   USDC_DECIMALS-aware balance/transfer helpers, which are what actually
 *   read/spend this wallet's USDC.
 *
 * Renders children unwrapped if VITE_PRIVY_APP_ID isn't set, so a
 * deployment that hasn't configured Privy yet doesn't crash on boot, and
 * doesn't even download the Privy/WalletConnect/viem bundle.
 */
export function PrivyProviders({ children }: { children: ReactNode }) {
  if (!isPrivyConfigured()) {
    return <>{children}</>;
  }

  // Fallback renders children unwrapped for the brief moment the Privy
  // chunk is loading, rather than blocking the whole app on it.
  return (
    <Suspense fallback={<>{children}</>}>
      <ConfiguredPrivyProviders>{children}</ConfiguredPrivyProviders>
    </Suspense>
  );
}
