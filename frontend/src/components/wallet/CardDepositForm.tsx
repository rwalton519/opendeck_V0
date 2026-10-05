import { useState, type FormEvent } from "react";
import { useStripe, useElements, PaymentElement } from "@stripe/react-stripe-js";

/**
 * Confirms a card/debit deposit with Stripe directly, using the
 * client_secret from walletApi.depositCard() (already mounted inside a
 * Stripe <Elements> provider by CardDepositFlow.tsx, which is what this
 * needs to be rendered inside of).
 *
 * The backend side of this flow is real and already working:
 *   1. POST /wallet/deposit creates a genuine Stripe PaymentIntent and
 *      returns its client_secret. Funds are NOT credited at this point.
 *   2. The signature-verified POST /wallet/webhooks/stripe handler is the
 *      ONLY thing that actually credits the deposit, once Stripe confirms
 *      the PaymentIntent succeeded.
 * This component is the step in between: actually submitting card details
 * to Stripe and confirming the PaymentIntent using that client_secret.
 */

type CardDepositFormProps = {
  /** Called once Stripe confirms the payment succeeded on the client side. */
  onSuccess?: () => void;
  /** Where Stripe redirects the user back to if a redirect-based method is used. Must be an absolute URL. */
  returnUrl?: string;
};

export function CardDepositForm({ onSuccess, returnUrl }: CardDepositFormProps) {
  const stripe = useStripe();
  const elements = useElements();

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return; // Stripe.js hasn't finished loading yet.

    setSubmitting(true);
    setErrorMessage(null);

    // Sends the card details the user entered into <PaymentElement>
    // straight to Stripe - they never touch OpenDeck's backend. Stripe
    // then attempts to charge the card against the PaymentIntent created
    // by POST /wallet/deposit.
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: returnUrl ? { return_url: returnUrl } : undefined,
      // 'if_required' avoids a full-page redirect for card payments (the
      // common case). If a redirect IS required (some non-card methods),
      // Stripe navigates away and the code below never runs - the user
      // lands back on `returnUrl` instead, where the webhook (unchanged,
      // already real) will have credited the deposit by the time they
      // arrive, assuming the charge succeeded.
      redirect: "if_required",
    });

    setSubmitting(false);

    if (error) {
      // Card declined, validation error, etc. The PaymentIntent was NOT
      // credited - no backend call needed here, nothing succeeded.
      setErrorMessage(error.message ?? "Payment failed. Please try again.");
      return;
    }

    // No error, no redirect: Stripe confirmed the payment client-side.
    // Actual crediting still happens asynchronously via the webhook once
    // Stripe finishes processing - usually a few seconds, not instant.
    onSuccess?.();
  }

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement />

      {errorMessage && (
        <div role="alert" style={{ color: "#e0655f", marginTop: "0.75rem", fontSize: "0.85rem" }}>
          {errorMessage}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || submitting}
        style={{
          marginTop: "1rem",
          width: "100%",
          padding: "0.75rem",
          borderRadius: "6px",
          border: "none",
          background: "linear-gradient(180deg, #e3c374, #c9a24b)",
          color: "#1a1305",
          fontWeight: 700,
          cursor: submitting ? "not-allowed" : "pointer",
          opacity: submitting ? 0.6 : 1,
        }}
      >
        {submitting ? "Processing…" : "Confirm Deposit"}
      </button>
    </form>
  );
}

export default CardDepositForm;
