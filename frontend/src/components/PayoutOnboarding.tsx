import { useEffect, useState } from 'react';
import {
  getPayoutOnboardingStatus,
  startPayoutOnboarding,
  type ConnectStatusResponse,
} from '../api/stripePayments';

/**
 * "Set up payouts" screen, driving routers/walletStripeConnect.js.
 *
 * That router's own header comment flags this explicitly: nothing in
 * frontend_new/src/api/*.ts calls these endpoints yet. This component is
 * the missing piece - wire it into the wallet/withdraw page behind a
 * "Set up payouts" button, gated on `!status.onboarded`.
 *
 * Flow:
 *   1. GET  /wallet/stripe-connect/status  -> check current state
 *   2. POST /wallet/stripe-connect/onboard -> get a Stripe-hosted URL
 *   3. Redirect the browser there. Stripe handles ID verification and bank
 *      account collection entirely on their side - no sensitive bank data
 *      ever touches this app's frontend or backend.
 *   4. Stripe redirects back to `returnUrl` (success) or `refreshUrl` (the
 *      user needs to re-enter the flow, e.g. their session expired
 *      mid-onboarding). Re-check status on mount to reflect that.
 */

interface PayoutOnboardingProps {
  userId: string;
  userEmail: string;
}

export function PayoutOnboarding({ userId, userEmail }: PayoutOnboardingProps) {
  const [status, setStatus] = useState<ConnectStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getPayoutOnboardingStatus(userId)
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load payout status.');
      })
      .finally(() => {
        if (!cancelled) setLoadingStatus(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function handleStartOnboarding() {
    setError(null);
    setRedirecting(true);
    try {
      // PLACEHOLDER: point these at real routes in this app. Stripe
      // requires both regardless of which path the user actually takes.
      const returnUrl = `${window.location.origin}/wallet/payouts/onboarding-complete`;
      const refreshUrl = `${window.location.origin}/wallet/payouts/onboarding-refresh`;

      const { url } = await startPayoutOnboarding(userId, userEmail, refreshUrl, returnUrl);
      window.location.assign(url);
    } catch (err) {
      setRedirecting(false);
      setError(err instanceof Error ? err.message : 'Could not start payout onboarding.');
    }
  }

  if (loadingStatus) {
    return <p>Checking payout setup…</p>;
  }

  if (status?.onboarded && status.payouts_enabled) {
    return (
      <div className="payout-onboarding payout-onboarding--complete">
        <p>Payouts are set up. Withdrawals go straight to your linked bank account.</p>
      </div>
    );
  }

  return (
    <div className="payout-onboarding">
      {status && status.details_submitted && !status.payouts_enabled ? (
        <p className="payout-onboarding__note">
          Your details were submitted, but Stripe hasn't finished verifying your account yet.
          This can take a little while - check back shortly, or continue below to finish anything left over.
        </p>
      ) : (
        <p>
          Set up payouts to withdraw real money to your bank account. You'll verify your
          identity and add a bank account through Stripe's secure onboarding flow - we never
          see or store your bank details directly.
        </p>
      )}

      {error && <p role="alert" className="payout-onboarding__error">{error}</p>}

      <button type="button" onClick={handleStartOnboarding} disabled={redirecting}>
        {redirecting ? 'Redirecting to Stripe…' : 'Set up payouts'}
      </button>
    </div>
  );
}
