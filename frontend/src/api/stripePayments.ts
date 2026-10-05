/**
 * API client for the backend's real Stripe endpoints.
 *
 * Backend contract sources (do not guess at shapes - these are documented):
 *   - POST /wallet/deposit               -> docs/DEPOSIT_CARD_PAYMENT_CONTRACT.md
 *   - POST /wallet/stripe-connect/onboard -> routers/walletStripeConnect.js
 *   - GET  /wallet/stripe-connect/status  -> routers/walletStripeConnect.js
 *
 * Nothing in here talks to Stripe directly except loadStripe() itself
 * (@stripe/stripe-js) - all PaymentIntent / Connect-account creation happens
 * server-side. This file only calls our own backend and forwards the
 * client_secret / onboarding URL it returns.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

export type DepositMethod = 'card' | 'debit' | 'square' | 'eWallet';

export interface CardDepositInitiatedResponse {
  success: true;
  message: string;
  transactionId: string;
  data: {
    method: DepositMethod;
    provider: 'stripe';
    client_secret: string;
  };
}

interface ApiErrorBody {
  detail?: string;
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (body as ApiErrorBody).detail || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

/**
 * Step 1 of the 3-step card deposit flow. Creates a Stripe PaymentIntent
 * server-side and returns its client_secret. The wallet is NOT credited
 * yet at this point - see docs/DEPOSIT_CARD_PAYMENT_CONTRACT.md.
 */
export async function createCardDeposit(
  userId: string,
  amount: number,
  method: DepositMethod = 'card'
): Promise<CardDepositInitiatedResponse> {
  const res = await fetch(`${API_BASE}/wallet/deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ user_id: userId, amount, method }),
  });
  return parseOrThrow<CardDepositInitiatedResponse>(res);
}

export interface ConnectOnboardResponse {
  url: string;
}

/**
 * Requests a Stripe-hosted onboarding link for payouts. Creates the user's
 * Connect account server-side on first call (idempotent on subsequent
 * calls - see walletStripeConnect.js's getOrCreateConnectAccount).
 */
export async function startPayoutOnboarding(
  userId: string,
  email: string,
  refreshUrl: string,
  returnUrl: string
): Promise<ConnectOnboardResponse> {
  const res = await fetch(`${API_BASE}/wallet/stripe-connect/onboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      user_id: userId,
      email,
      refresh_url: refreshUrl,
      return_url: returnUrl,
    }),
  });
  return parseOrThrow<ConnectOnboardResponse>(res);
}

export interface ConnectStatusResponse {
  onboarded: boolean;
  payouts_enabled: boolean;
  charges_enabled: boolean;
  details_submitted: boolean;
}

export async function getPayoutOnboardingStatus(userId: string): Promise<ConnectStatusResponse> {
  const res = await fetch(`${API_BASE}/wallet/stripe-connect/status?user_id=${encodeURIComponent(userId)}`, {
    credentials: 'include',
  });
  return parseOrThrow<ConnectStatusResponse>(res);
}
