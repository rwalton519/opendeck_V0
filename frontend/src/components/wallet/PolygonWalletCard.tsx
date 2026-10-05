import { useEffect, useState } from "react";
import { GlassPanel } from "../ui/GlassPanel";
import { usePrivyWalletLink } from "../../hooks/usePrivyWalletLink";
import { getUsdcBalanceReadOnly } from "../../lib/blockchain/browserWallet";
import { chain } from "../../config/chain";
import { isPrivyConfigured } from "../../config/env";
import styles from "./PolygonWalletCard.module.css";

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatUsdc(amount: number): string {
  return `${amount.toFixed(2)} USDC`;
}

/**
 * Shows the player's Polygon wallet (address + live USDC balance) once
 * usePrivyWalletLink has linked one - either a Privy-created embedded
 * wallet (auto-created on email registration, see RegisterPage's
 * PrivyWalletActivation step) or a manually connected external wallet
 * (see CashGameTablePage's "Connect Wallet" flow for MetaMask), since both
 * end up linked through the same POST /wallet/onchain/link endpoint and
 * this card doesn't need to distinguish between them.
 *
 * Renders nothing if Privy isn't configured for this build and no wallet
 * is linked - a deployment without USDC play configured shouldn't show an
 * empty/placeholder card.
 */
export function PolygonWalletCard() {
  const linkState = usePrivyWalletLink();
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  useEffect(() => {
    if (linkState.status !== "linked" || !linkState.address) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    getUsdcBalanceReadOnly(linkState.address)
      .then((value) => {
        if (!cancelled) setBalance(value);
      })
      .catch((err) => {
        if (!cancelled) setBalanceError(err instanceof Error ? err.message : "Could not read wallet balance.");
      });
    return () => {
      cancelled = true;
    };
  }, [linkState.status, linkState.address]);

  if (!isPrivyConfigured() && linkState.status === "unavailable") {
    return null;
  }

  return (
    <GlassPanel className={styles.card}>
      <p className={styles.label}>Polygon Wallet</p>

      {linkState.status === "linked" && linkState.address && (
        <>
          <p className={styles.address}>{shortenAddress(linkState.address)}</p>
          <p className={styles.balance}>{balance !== null ? formatUsdc(balance) : "—"}</p>
          {balanceError && <p className={styles.error}>{balanceError}</p>}
          <p className={styles.network}>{chain.name}</p>
        </>
      )}

      {(linkState.status === "checking" || linkState.status === "linking") && (
        <p className={styles.muted}>
          {linkState.status === "checking" ? "Checking wallet status…" : "Activating your Polygon wallet…"}
        </p>
      )}

      {linkState.status === "error" && (
        <p className={styles.error}>{linkState.error ?? "Could not activate your Polygon wallet."}</p>
      )}

      {linkState.status === "idle" && <p className={styles.muted}>No Polygon wallet linked yet.</p>}
    </GlassPanel>
  );
}
