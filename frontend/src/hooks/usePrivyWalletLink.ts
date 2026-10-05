import { useContext } from "react";
import { PrivyWalletLinkContext, type PrivyWalletLinkState } from "../context/PrivyWalletLinkContext";

/**
 * Reads the current Privy wallet auto-link status. The actual linking
 * effect runs exactly once, in PrivyWalletLinkProvider (mounted in
 * main.tsx) - this hook is just a read of its published state, so it's
 * safe to call from multiple components (AppShell, PolygonWalletCard, ...)
 * without triggering duplicate link attempts.
 */
export function usePrivyWalletLink(): PrivyWalletLinkState {
  return useContext(PrivyWalletLinkContext);
}
