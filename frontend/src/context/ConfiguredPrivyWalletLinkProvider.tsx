import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { onchainApi } from "../api/onchain";
import { signMessageWithProvider, type Eip1193Provider } from "../lib/blockchain/browserWallet";
import { useAuth } from "../hooks/useAuth";
import { PrivyWalletLinkContext, defaultPrivyWalletLinkState } from "./PrivyWalletLinkContext";

/**
 * The actual Privy-SDK-touching half of PrivyWalletLinkContext.tsx's
 * provider, split out so "@privy-io/react-auth" is only ever fetched via
 * the React.lazy() in PrivyWalletLinkContext.tsx when Privy is configured -
 * see PrivyProviders.tsx / ConfiguredPrivyProviders.tsx for the same split
 * applied to the provider that actually renders <PrivyProvider>.
 *
 * Auto-links a Privy embedded wallet to the signed-in OpenDeck account, and
 * publishes the result via context so any component (AppShell,
 * PolygonWalletCard, ...) can read the current status without each one
 * re-running the link attempt itself - the actual sign-and-POST flow below
 * runs exactly once per (userId, wallet address) pair for the whole app,
 * no matter how many components read the status.
 *
 * The wallet itself is created automatically by Privy on email login (see
 * providers/ConfiguredPrivyProviders.tsx's embeddedWallets.ethereum.createOnLogin
 * config) - this provider is the second half: once that wallet exists AND the
 * player is signed in to the OpenDeck backend (our own email/password
 * session, not Privy's), it reuses the exact same sign-message-and-POST
 * flow that CashGameTablePage already uses for a MetaMask "Connect
 * Wallet" button (see src/api/onchain.ts / services/blockchain/onchainRakeService.js
 * on the backend), just sourcing the signature from Privy's embedded
 * wallet provider instead of window.ethereum. No backend changes were
 * needed for this - the backend verifies wallet ownership by recovering
 * the signer from the signature, which works identically regardless of
 * which wallet produced it.
 */
export default function ConfiguredPrivyWalletLinkProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { isAuthenticated, userId } = useAuth();

  const [state, setState] = useState(defaultPrivyWalletLinkState);
  const attemptedFor = useRef<string | null>(null);

  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");

  useEffect(() => {
    if (!ready || !authenticated || !embeddedWallet || !isAuthenticated || !userId) {
      return;
    }

    const attemptKey = `${userId}:${embeddedWallet.address}`;
    if (attemptedFor.current === attemptKey) {
      return;
    }
    attemptedFor.current = attemptKey;

    let cancelled = false;

    (async () => {
      setState({ status: "checking", address: embeddedWallet.address, error: null });
      try {
        const summary = await onchainApi.getSummary();

        if (summary.address) {
          // Already linked (to this wallet or a previously-linked one) -
          // nothing to do. Report whichever address the backend actually
          // has on file, not necessarily the embedded wallet's, since a
          // player who separately linked MetaMask should see that address.
          if (!cancelled) setState({ status: "linked", address: summary.address, error: null });
          return;
        }

        if (!cancelled) setState({ status: "linking", address: embeddedWallet.address, error: null });

        const message = await onchainApi.getLinkMessage(embeddedWallet.address);
        const provider = (await embeddedWallet.getEthereumProvider()) as Eip1193Provider;
        const signature = await signMessageWithProvider(provider, embeddedWallet.address, message);
        const result = await onchainApi.linkWallet(embeddedWallet.address, signature);

        if (!cancelled) setState({ status: "linked", address: result.address, error: null });
      } catch (err) {
        // Not fatal to the app - the player can still play with off-chain
        // chips; on-chain USDC rebuys just won't be available until this
        // succeeds. attemptedFor is left set on error (deliberately, not
        // reset) so a persistent failure doesn't retry on every render -
        // the player can retry manually via WalletPage in a future pass.
        if (!cancelled) {
          setState({
            status: "error",
            address: embeddedWallet.address,
            error: err instanceof Error ? err.message : "Failed to link Polygon wallet.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, embeddedWallet, isAuthenticated, userId]);

  return <PrivyWalletLinkContext.Provider value={state}>{children}</PrivyWalletLinkContext.Provider>;
}
