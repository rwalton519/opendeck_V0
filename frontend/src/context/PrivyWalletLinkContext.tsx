import { createContext, Suspense, lazy, type ReactNode } from "react";
import { isPrivyConfigured } from "../config/env";

export type PrivyWalletLinkStatus = "idle" | "checking" | "linking" | "linked" | "error" | "unavailable";

export interface PrivyWalletLinkState {
  status: PrivyWalletLinkStatus;
  address: string | null;
  error: string | null;
}

export const defaultPrivyWalletLinkState: PrivyWalletLinkState = { status: "idle", address: null, error: null };

export const PrivyWalletLinkContext = createContext<PrivyWalletLinkState>(defaultPrivyWalletLinkState);

// FIXED (landing page blank / oversized entry bundle): this file used to
// statically import "usePrivy"/"useWallets" from "@privy-io/react-auth" at
// the top for the Configured branch below, pulling that SDK into the app's
// one entry chunk - mounted here in main.tsx on every route including "/" -
// even when Privy isn't configured. The actual hook-using provider now
// lives in ConfiguredPrivyWalletLinkProvider.tsx, loaded via React.lazy()
// only when isPrivyConfigured() is true. See PrivyProviders.tsx /
// ConfiguredPrivyProviders.tsx for the identical split applied there.
const ConfiguredPrivyWalletLinkProvider = lazy(() => import("./ConfiguredPrivyWalletLinkProvider"));

const unavailableState: PrivyWalletLinkState = { status: "unavailable", address: null, error: null };

export function PrivyWalletLinkProvider({ children }: { children: ReactNode }) {
  // Privy is optional in this frontend build. Keep the hook-using portion
  // behind a real component boundary (and a separate chunk) so an
  // unconfigured deployment never calls usePrivy()/useWallets() outside a
  // <PrivyProvider> - which used to crash the entire landing page before
  // React could render anything - and never even downloads the SDK that
  // could do so.
  if (!isPrivyConfigured()) {
    return (
      <PrivyWalletLinkContext.Provider value={unavailableState}>{children}</PrivyWalletLinkContext.Provider>
    );
  }

  return (
    <Suspense
      fallback={
        <PrivyWalletLinkContext.Provider value={defaultPrivyWalletLinkState}>
          {children}
        </PrivyWalletLinkContext.Provider>
      }
    >
      <ConfiguredPrivyWalletLinkProvider>{children}</ConfiguredPrivyWalletLinkProvider>
    </Suspense>
  );
}
