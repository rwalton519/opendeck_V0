import { useCallback, useEffect, useState } from "react";
import { walletApi } from "../../api/wallet";
import { useAuth } from "../../hooks/useAuth";
import { GlassPanel } from "../ui/GlassPanel";
import { Button } from "../ui/Button";
import type { PayoutStatus } from "../../types/wallet";
import styles from "./PayoutSetup.module.css";

/**
 * "Set up payouts" flow for backend_new's Stripe Connect wiring
 * (POST /wallet/stripe-connect/onboard, GET /wallet/stripe-connect/status).
 *
 * A withdrawal can only actually pay out to a real bank account once a user
 * has completed Stripe's own hosted onboarding (ID verification, bank
 * account entry) for a Connect Express account - this component is what
 * gets them there and reports whether they've finished it.
 *
 * This intentionally does NOT collect any bank/card details itself - all of
 * that happens on Stripe's own page after redirecting away from this app,
 * which is the whole point of using Stripe Connect rather than building
 * that collection flow (and its compliance burden) from scratch.
 */
export function PayoutSetup() {
  const { userId, email } = useAuth();

  const [status, setStatus] = useState<PayoutStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await walletApi.getPayoutStatus(userId);
      setStatus(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check payout setup status.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadStatus();
    // Re-checks on every visit, which naturally covers the case where the
    // user just came back from completing (or abandoning) Stripe's
    // onboarding flow - Stripe redirects back to this same page via
    // return_url/refresh_url below, no special query-param handling needed.
  }, [loadStatus]);

  async function handleSetUpPayouts() {
    if (!userId) return;

    if (!email) {
      // Can happen for a session started before email was captured at
      // login (see AuthContext.tsx) - rather than send a request the
      // backend will reject, ask for a fresh login so a real email is on
      // hand for the Connect account.
      setError("Please log in again to set up payouts.");
      return;
    }

    setError(null);
    setRedirecting(true);
    try {
      // Stripe sends the user back to whichever of these applies: return_url
      // on a completed (or abandoned-but-valid) session, refresh_url if the
      // onboarding link itself expired before they finished. Both point
      // back here since either way, this component just re-checks status
      // on load and shows the right thing.
      const pageUrl = `${window.location.origin}/wallet`;
      const result = await walletApi.startPayoutOnboarding(userId, email, pageUrl, pageUrl);
      window.location.href = result.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start payout setup.");
      setRedirecting(false);
    }
  }

  if (!userId) return null;

  return (
    <GlassPanel>
      <h2 className={styles.sectionTitle}>Payouts</h2>

      {loading && <p className={styles.muted}>Checking payout setup…</p>}

      {!loading && error && (
        <>
          <p className={styles.messageError}>{error}</p>
          <Button variant="ghost" onClick={loadStatus}>
            Retry
          </Button>
        </>
      )}

      {!loading && !error && status?.payoutsEnabled && (
        <div className={styles.enabledRow}>
          <span className={styles.enabledBadge}>✓ Payouts enabled</span>
          <p className={styles.muted}>Withdrawals to your bank account are ready to go.</p>
        </div>
      )}

      {!loading && !error && !status?.payoutsEnabled && (
        <div>
          <p className={styles.muted}>
            {status?.detailsSubmitted
              ? "You've started payout setup, but Stripe hasn't finished verifying your account yet. You can continue or check on it below."
              : "Set up payouts to enable real withdrawals to your bank account."}
          </p>
          <Button onClick={handleSetUpPayouts} disabled={redirecting} className={styles.setupButton}>
            {redirecting ? "Redirecting to Stripe…" : status?.detailsSubmitted ? "Continue Payout Setup" : "Set Up Payouts"}
          </Button>
        </div>
      )}
    </GlassPanel>
  );
}
