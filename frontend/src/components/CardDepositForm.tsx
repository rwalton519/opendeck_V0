import { useState, type FormEvent } from 'react';
import {
  CardElement,
  Elements,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { createCardDeposit, type DepositMethod } from '../api/stripePayments';

/**
 * Completes the client-side confirmation step of the 3-step card deposit
 * flow described in docs/DEPOSIT_CARD_PAYMENT_CONTRACT.md:
 *
 *   1. POST /wallet/deposit           -> client_secret        (this file, step 1)
 *   2. stripe.confirmCardPayment(...) -> collects card details (this file, step 2 -
 *                                         same call named explicitly in that doc)
 *   3. POST /wallet/webhooks/stripe   -> credits the wallet    (backend, async - NOT this file)
 *
 * Uses CardElement + confirmCardPayment (not the newer PaymentElement) to
 * match the backend's PaymentIntent exactly as it's created today in
 * services/payments/stripeService.js's createDepositIntent() - a plain
 * `stripe.paymentIntents.create({ amount, currency, metadata })` with no
 * `automatic_payment_methods` or `payment_method_types` configured, which
 * defaults to card-only. If that changes server-side to support other
 * payment method types, swap this for PaymentElement + confirmPayment.
 *
 * IMPORTANT: a successful confirmCardPayment() call here means the card
 * charge went through on Stripe's side. It does NOT mean the wallet balance
 * has updated yet - that only happens once Stripe's webhook reaches step 3
 * on the backend, which can lag by a few seconds. Poll /wallet/balance or
 * subscribe to whatever real-time balance channel the app already uses
 * after a successful confirmation; don't assume it's instant.
 */

// PLACEHOLDER: replace with your real Stripe publishable key, from env,
// never hardcoded. This is the PUBLIC key (pk_...), safe for the client -
// it is not the secret key and cannot move money on its own.
const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? 'pk_test_PLACEHOLDER';

let stripePromise: Promise<Stripe | null> | null = null;
function getStripe() {
  if (!stripePromise) {
    stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY);
  }
  return stripePromise;
}

interface CardDepositFormProps {
  userId: string;
  method?: DepositMethod;
  onSuccess?: (transactionId: string) => void;
}

export function CardDepositForm({ userId, method = 'card', onSuccess }: CardDepositFormProps) {
  const [amount, setAmount] = useState('50');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const amountNumber = Number.parseFloat(amount);

  // Step 1: ask the backend to create the PaymentIntent.
  async function handleStartDeposit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setError('Enter a deposit amount greater than $0.');
      return;
    }

    setLoading(true);
    try {
      const result = await createCardDeposit(userId, amountNumber, method);
      setClientSecret(result.data.client_secret);
      setTransactionId(result.transactionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start deposit.');
    } finally {
      setLoading(false);
    }
  }

  if (clientSecret) {
    return (
      <Elements stripe={getStripe()}>
        <ConfirmDepositStep
          clientSecret={clientSecret}
          amount={amountNumber}
          transactionId={transactionId}
          onSuccess={onSuccess}
          onCancel={() => {
            setClientSecret(null);
            setTransactionId(null);
          }}
        />
      </Elements>
    );
  }

  return (
    <form onSubmit={handleStartDeposit} className="deposit-form">
      <label htmlFor="deposit-amount">Deposit amount (USD)</label>
      <input
        id="deposit-amount"
        type="number"
        min="1"
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        disabled={loading}
      />

      {error && <p role="alert" className="deposit-form__error">{error}</p>}

      <button type="submit" disabled={loading}>
        {loading ? 'Starting deposit…' : 'Continue to payment'}
      </button>
    </form>
  );
}

interface ConfirmDepositStepProps {
  clientSecret: string;
  amount: number;
  transactionId: string | null;
  onSuccess?: (transactionId: string) => void;
  onCancel: () => void;
}

function ConfirmDepositStep({ clientSecret, amount, transactionId, onSuccess, onCancel }: ConfirmDepositStepProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'processing' | 'succeeded'>('idle');

  // Step 2: confirm the payment client-side against Stripe directly. This
  // never touches our own backend - it's a call straight to Stripe's API
  // using the client_secret from step 1.
  async function handleConfirm(e: FormEvent) {
    e.preventDefault();
    const cardElement = elements?.getElement(CardElement);
    if (!stripe || !elements || !cardElement) return;

    setSubmitting(true);
    setError(null);
    setStatus('processing');

    const { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: { card: cardElement },
    });

    setSubmitting(false);

    if (confirmError) {
      setStatus('idle');
      setError(confirmError.message ?? 'Payment could not be confirmed.');
      return;
    }

    if (paymentIntent?.status === 'succeeded') {
      setStatus('succeeded');
      if (transactionId) onSuccess?.(transactionId);
      return;
    }

    // Some payment methods land in "processing" rather than "succeeded"
    // immediately - that's expected, not an error. The wallet credit still
    // only happens once the backend's webhook receives the final event.
    setStatus('processing');
  }

  if (status === 'succeeded') {
    return (
      <div className="deposit-form__success">
        <p>Card charged for ${amount.toFixed(2)}.</p>
        <p className="deposit-form__note">
          Your balance updates once our server confirms the payment (usually a few seconds) -
          it won't reflect instantly on this screen.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleConfirm} className="deposit-form deposit-form--confirm">
      <CardElement options={{ hidePostalCode: false }} />

      {error && <p role="alert" className="deposit-form__error">{error}</p>}

      <div className="deposit-form__actions">
        <button type="button" onClick={onCancel} disabled={submitting}>
          Back
        </button>
        <button type="submit" disabled={!stripe || submitting}>
          {submitting || status === 'processing' ? 'Processing…' : `Pay $${amount.toFixed(2)}`}
        </button>
      </div>
    </form>
  );
}
