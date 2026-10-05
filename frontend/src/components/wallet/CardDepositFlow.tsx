import { useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { CardDepositForm } from "./CardDepositForm";
import { walletApi } from "../../api/wallet";
import { env, getStripeKeyIssue } from "../../config/env";
import type { PaymentMethodType } from "../../types/wallet";

// Loaded once at module scope per Stripe's own recommendation (avoid
// re-creating this on every render). If the key is missing/placeholder,
// loadStripe still resolves to a stub that will fail clearly at
// confirmPayment() time rather than at import time - but see
// getStripeKeyIssue() below, which now catches the production-specific
// case (missing or still-test-mode key) up front, before the user ever
// gets to that point.
const stripePromise = loadStripe(env.stripePublishableKey || "");

// How long to keep checking the balance after Stripe confirms client-side,
// before giving up and telling the user to check back later. The webhook
// (POST /wallet/webhooks/stripe) usually fires within a few seconds, but
// this is not guaranteed instant, so this polls rather than assuming.
const BALANCE_POLL_INTERVAL_MS = 2000;
const BALANCE_POLL_ATTEMPTS = 8; // ~16s total

type Step = "amount" | "pay" | "confirming" | "credited" | "timed_out";

type CardDepositFlowProps = {
  userId: string;
  method: Extract<PaymentMethodType, "card" | "debit" | "square" | "eWallet">;
  initialAmount: string;
  onCredited: () => void; // parent should refresh balance/transactions
  onCancel: () => void;
};

export function CardDepositFlow({ userId, method, initialAmount, onCredited, onCancel }: CardDepositFlowProps) {
  const stripeKeyIssue = useMemo(() => getStripeKeyIssue(), []);
  const [amount, setAmount] = useState(initialAmount);
  const [step, setStep] = useState<Step>("amount");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const parsedAmount = Number(amount);
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;

  async function handleStart() {
    if (!validAmount) {
      setStartError("Enter a valid amount.");
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      const result = await walletApi.depositCard(userId, parsedAmount, method);
      setClientSecret(result.data.client_secret);
      setStep("pay");
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Could not start deposit.");
    } finally {
      setStarting(false);
    }
  }

  async function handleConfirmed() {
    setStep("confirming");
    const startingBalance = await walletApi.getBalance(userId).catch(() => null);

    for (let attempt = 0; attempt < BALANCE_POLL_ATTEMPTS; attempt += 1) {
      await new Promise((r) => setTimeout(r, BALANCE_POLL_INTERVAL_MS));
      try {
        const current = await walletApi.getBalance(userId);
        if (startingBalance === null || current > startingBalance) {
          setStep("credited");
          onCredited();
          return;
        }
      } catch {
        // transient fetch error while polling - just try again next tick
      }
    }
    setStep("timed_out");
  }

  const elementsOptions = useMemo(() => (clientSecret ? { clientSecret } : null), [clientSecret]);

  // Refuse to proceed at all in a production build with a missing or
  // still-test-mode Stripe key, rather than letting the user fill out an
  // amount and only discover the problem when Stripe's confirmation step
  // fails with a confusing error. See getStripeKeyIssue() in config/env.ts.
  if (stripeKeyIssue) {
    return (
      <div style={{ marginTop: "0.75rem" }}>
        <p style={{ color: "#e0655f", fontSize: "0.85rem" }}>{stripeKeyIssue}</p>
        <button onClick={onCancel} type="button">
          Close
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: "0.75rem" }}>
      {step === "amount" && (
        <div>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount"
            style={{ width: "100%", marginBottom: "0.5rem" }}
          />
          {startError && <p style={{ color: "#e0655f", fontSize: "0.85rem" }}>{startError}</p>}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={handleStart} disabled={starting || !validAmount}>
              {starting ? "Starting…" : `Continue to payment`}
            </button>
            <button onClick={onCancel} type="button">
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === "pay" && elementsOptions && (
        <Elements stripe={stripePromise} options={elementsOptions}>
          <CardDepositForm
            onSuccess={handleConfirmed}
            returnUrl={`${window.location.origin}/wallet`}
          />
        </Elements>
      )}

      {step === "confirming" && (
        <p style={{ fontSize: "0.85rem", opacity: 0.8 }}>
          Payment confirmed with Stripe — waiting for it to reflect in your balance…
        </p>
      )}

      {step === "credited" && (
        <p style={{ color: "#3fbf7f", fontSize: "0.9rem" }}>Deposit complete — your balance has been updated.</p>
      )}

      {step === "timed_out" && (
        <p style={{ fontSize: "0.85rem", opacity: 0.8 }}>
          Stripe confirmed the payment, but it's taking longer than usual to reflect in your balance.
          This does not mean it failed — refresh this page in a minute to check again.
        </p>
      )}
    </div>
  );
}
