import { apiClient } from "./client";
import type {
  PaymentMethodType,
  PaymentResult,
  WalletTransaction,
  PayoutOnboardingResult,
  PayoutStatus,
  PaymentMethodCapabilities,
} from "../types/wallet";
import { FALLBACK_PAYMENT_METHOD_CAPABILITIES } from "../types/wallet";

/** Backends commonly use snake_case; normalize once here rather than in every screen. */
function normalizeTransaction(raw: Record<string, unknown>): WalletTransaction {
  return {
    id: String(raw.id),
    type: raw.type as WalletTransaction["type"],
    amount: Number(raw.amount),
    timestamp: String(raw.timestamp),
    status: (raw.status as WalletTransaction["status"]) ?? "pending",
  };
}

function normalizePayoutStatus(raw: Record<string, unknown>): PayoutStatus {
  return {
    onboarded: Boolean(raw.onboarded),
    payoutsEnabled: Boolean(raw.payouts_enabled),
    chargesEnabled: Boolean(raw.charges_enabled),
    detailsSubmitted: Boolean(raw.details_submitted),
  };
}

/** Tolerates a boolean, or a status-word string like "real"/"implemented"/"not_implemented". */
function toSupported(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return /^(real|full|yes|true|supported|implemented|enabled)$/i.test(value.trim());
  }
  return false;
}

/**
 * Tolerates either an object keyed by method name, or an array of
 * `{ method, deposit, withdraw }` records - the exact live shape wasn't
 * pinned down against a running backend, so this accepts both rather than
 * assuming one and silently returning nothing if it guessed wrong.
 */
function normalizeCapabilities(raw: unknown): PaymentMethodCapabilities {
  const out: PaymentMethodCapabilities = {};

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const method = e.method as PaymentMethodType | undefined;
      if (!method) continue;
      out[method] = { deposit: toSupported(e.deposit), withdraw: toSupported(e.withdraw) };
    }
  } else if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      out[key as PaymentMethodType] = { deposit: toSupported(v.deposit), withdraw: toSupported(v.withdraw) };
    }
  }

  return out;
}

// ------------------------------------------------------------------
// Card deposit (Stripe). Backed by POST /wallet/deposit on the backend -
// see backend_new/docs/DEPOSIT_CARD_PAYMENT_CONTRACT.md for the full
// request/response contract this type mirrors.
//
// A card/debit/square/eWallet deposit only ever CREATES a Stripe
// PaymentIntent server-side; it does not complete the payment. The
// wallet is credited later, out-of-band, by the backend's Stripe webhook
// once the customer finishes payment client-side via
// components/wallet/CardDepositFlow.tsx, which needs `client_secret` from
// this response to hand to Stripe.js. Unlike the generic `PaymentResult`
// from `deposit()`, this type makes `client_secret` non-optional: the
// card-deposit screen cannot proceed without it, and should fail loudly
// (not silently) if the backend ever omits it.
// ------------------------------------------------------------------
export interface CardDepositResult {
  success: true;
  message: string;
  transactionId: string;
  data: {
    method: PaymentMethodType;
    provider: "stripe";
    client_secret: string;
  };
}

const CARD_METHODS: PaymentMethodType[] = ["card", "debit", "square", "eWallet"];

export const walletApi = {
  async getBalance(userId: string): Promise<number> {
    const res = await apiClient.get<{ balance: number }>(`/wallet/balance?user_id=${encodeURIComponent(userId)}`);
    return res.balance ?? 0;
  },

  async getTransactions(userId: string): Promise<WalletTransaction[]> {
    const res = await apiClient.get<{ transactions: Record<string, unknown>[] }>(
      `/wallet/transactions?user_id=${encodeURIComponent(userId)}`,
    );
    return (res.transactions ?? []).map(normalizeTransaction);
  },

  async deposit(userId: string, amount: number, method: PaymentMethodType): Promise<PaymentResult> {
    const res = await apiClient.post<Partial<PaymentResult>>("/wallet/deposit", {
      user_id: userId,
      amount,
      method,
    });
    return { success: res.success ?? false, message: res.message ?? "", transactionId: res.transactionId, data: res.data };
  },

  /**
   * Card-deposit-specific entry point for the Stripe Elements flow
   * (CardDepositFlow.tsx). Thin wrapper around `deposit()` - same POST
   * /wallet/deposit call, no duplicated request logic - but narrows and
   * validates the response so callers get a `client_secret` they can
   * trust rather than an untyped `data` blob.
   *
   * Throws if the backend reports failure, or reports success without a
   * `client_secret` - either case means the card form has nothing to hand
   * to `stripe.confirmPayment()` and should not proceed.
   */
  async depositCard(
    userId: string,
    amount: number,
    method: Extract<PaymentMethodType, "card" | "debit" | "square" | "eWallet"> = "card",
  ): Promise<CardDepositResult> {
    if (!CARD_METHODS.includes(method)) {
      throw new Error(`depositCard() only supports ${CARD_METHODS.join(", ")}, got "${method}"`);
    }

    const res = await walletApi.deposit(userId, amount, method);

    if (!res.success) {
      throw new Error(res.message || "Deposit could not be initiated.");
    }

    const clientSecret = (res.data as { client_secret?: unknown } | undefined)?.client_secret;
    if (typeof clientSecret !== "string" || !clientSecret) {
      throw new Error("Deposit was initiated but the backend did not return a client_secret.");
    }

    return {
      success: true,
      message: res.message,
      transactionId: res.transactionId ?? "",
      data: {
        method,
        provider: "stripe",
        client_secret: clientSecret,
      },
    };
  },

  /**
   * `address` is required by the backend specifically for method:
   * "cryptoMonero" (the destination the on-chain payout is sent to once
   * an admin approves the withdrawal) - see WithdrawPage.tsx, which is
   * the only caller that currently passes one. Omitted (undefined) for
   * every other method, matching the previous request shape exactly.
   */
  async withdraw(userId: string, amount: number, method: PaymentMethodType, address?: string): Promise<PaymentResult> {
    const res = await apiClient.post<Partial<PaymentResult>>("/wallet/withdraw", {
      user_id: userId,
      amount,
      method,
      ...(address ? { address } : {}),
    });
    return { success: res.success ?? false, message: res.message ?? "", transactionId: res.transactionId, data: res.data };
  },

  // ------------------------------------------------------------------
  // Crypto deposit flow. The original CryptoDepositScreen received its
  // deposit address as a hardcoded widget constructor param and never
  // actually called a backend for it, faking confirmation with a local
  // 3-tick timer. These two calls are the real endpoints that should
  // back that screen; until the backend implements them the page below
  // will surface a normal loading/error state rather than pretending
  // to confirm a deposit that never happened.
  // ------------------------------------------------------------------
  async getCryptoDepositAddress(asset: string, userId: string): Promise<{ asset: string; address: string }> {
    return apiClient.get(`/wallet/crypto-deposit-address?asset=${encodeURIComponent(asset)}&user_id=${encodeURIComponent(userId)}`);
  },

  async getCryptoDepositStatus(asset: string, userId: string): Promise<{ confirmed: boolean; confirmations?: number }> {
    return apiClient.get(
      `/wallet/crypto-deposit-status?asset=${encodeURIComponent(asset)}&user_id=${encodeURIComponent(userId)}`,
    );
  },

  // ------------------------------------------------------------------
  // Stripe Connect payout setup. See backend_new/routers/walletStripeConnect.js.
  // A user needs to complete this once before a real withdrawal can pay out
  // to their actual bank account - see components/wallet/PayoutSetup.tsx.
  // ------------------------------------------------------------------
  async startPayoutOnboarding(
    userId: string,
    email: string,
    refreshUrl: string,
    returnUrl: string,
  ): Promise<PayoutOnboardingResult> {
    return apiClient.post<PayoutOnboardingResult>("/wallet/stripe-connect/onboard", {
      user_id: userId,
      email,
      refresh_url: refreshUrl,
      return_url: returnUrl,
    });
  },

  async getPayoutStatus(userId: string): Promise<PayoutStatus> {
    const raw = await apiClient.get<Record<string, unknown>>(
      `/wallet/stripe-connect/status?user_id=${encodeURIComponent(userId)}`,
    );
    return normalizePayoutStatus(raw);
  },

  // ------------------------------------------------------------------
  // Payment method capabilities - see types/wallet.ts for background.
  // Drives WithdrawPage.tsx's method list so it can never drift from what
  // the backend actually supports again.
  // ------------------------------------------------------------------
  async getPaymentMethodCapabilities(): Promise<PaymentMethodCapabilities> {
    try {
      const raw = await apiClient.get<unknown>("/wallet/payment-methods/capabilities");
      const normalized = normalizeCapabilities(raw);
      // Fill in / override with the documented fallback for any method the
      // live response omitted or reported in a shape we didn't recognize -
      // a partial or malformed response should never silently hide a
      // method known to be real.
      return { ...FALLBACK_PAYMENT_METHOD_CAPABILITIES, ...normalized };
    } catch {
      // Endpoint unreachable (network error, backend down, etc.) - fall
      // back to the documented matrix rather than leaving the withdraw
      // form with no methods at all.
      return FALLBACK_PAYMENT_METHOD_CAPABILITIES;
    }
  },
};
