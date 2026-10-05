/**
 * The Flutter source had two independent definitions of these types:
 *   - lib/models/payment_method_type.dart: creditCard | debitCard | paypal | crypto
 *   - lib/services/payment_service.dart:   card | debit | bankTransfer | eTransfer |
 *       eWallet | square | cryptoBtc | cryptoEth | cryptoMonero | cryptoOther | inAppPurchase
 * Only the first (narrower) one was actually wired into any screen; the second,
 * richer one belonged to an unused PaymentService/MockPaymentService pair.
 * This file keeps the richer set — it's the more complete real-world option
 * list (and matches an e-Transfer-aware, Canada-facing product) — as the one
 * definition going forward.
 */
export type PaymentMethodType =
  | "card"
  | "debit"
  | "bankTransfer"
  | "eTransfer"
  | "eWallet"
  | "square"
  | "cryptoBtc"
  | "cryptoEth"
  | "cryptoMonero"
  | "cryptoOther";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodType, string> = {
  card: "Credit / Debit Card",
  debit: "Debit",
  bankTransfer: "Bank Transfer",
  eTransfer: "Interac e-Transfer",
  eWallet: "e-Wallet",
  square: "Square",
  cryptoBtc: "Bitcoin",
  cryptoEth: "Ethereum",
  cryptoMonero: "Monero",
  cryptoOther: "Other Crypto",
};

export const CRYPTO_METHODS: PaymentMethodType[] = ["cryptoBtc", "cryptoEth", "cryptoMonero", "cryptoOther"];

export const CRYPTO_ASSET_BY_METHOD: Partial<Record<PaymentMethodType, string>> = {
  cryptoBtc: "BTC",
  cryptoEth: "ETH",
  cryptoMonero: "XMR",
};

export interface PaymentResult {
  success: boolean;
  message: string;
  transactionId?: string;
  data?: unknown;
}

export type WalletTransactionType = "deposit" | "withdrawal";
export type WalletTransactionStatus = "pending" | "succeeded" | "failed" | "rejected";

export interface WalletTransaction {
  id: string;
  type: WalletTransactionType;
  amount: number;
  timestamp: string; // ISO 8601
  status: WalletTransactionStatus;
}

export interface PendingWithdrawal {
  id: string;
  userId: string;
  amount: number;
  method: PaymentMethodType;
  timestamp: string;
}

// ADDED: Stripe Connect payout setup - backend_new/routers/walletStripeConnect.js
export interface PayoutOnboardingResult {
  url: string;
}

export interface PayoutStatus {
  onboarded: boolean;
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
}

// ------------------------------------------------------------------
// Payment method capabilities. Backed by
// GET /wallet/payment-methods/capabilities (utils/paymentMethods.js on
// the backend), which reports, per method, whether deposit/withdraw is
// actually implemented (vs. an HTTP 501 stub). Previously implemented on
// the backend but never called from this app - WithdrawPage.tsx instead
// hardcoded a method list that didn't match reality (three of four
// methods 501'd; the one fully-working crypto method, cryptoMonero,
// wasn't offered at all). See api/wallet.ts's getPaymentMethodCapabilities().
// ------------------------------------------------------------------
export interface PaymentMethodCapability {
  deposit: boolean;
  withdraw: boolean;
}

export type PaymentMethodCapabilities = Partial<Record<PaymentMethodType, PaymentMethodCapability>>;

/**
 * Mirrors the backend's documented capability matrix as of this writing.
 * Used as a fallback whenever the live endpoint is unreachable or returns
 * a shape this app doesn't recognize, and to fill in any method a partial
 * live response omits - so a network hiccup can never silently make a
 * real method (e.g. cryptoMonero) disappear from the withdraw form, and
 * a backend hiccup can never silently make a 501 method reappear.
 */
export const FALLBACK_PAYMENT_METHOD_CAPABILITIES: PaymentMethodCapabilities = {
  card: { deposit: true, withdraw: true },
  debit: { deposit: true, withdraw: true },
  square: { deposit: true, withdraw: true },
  eWallet: { deposit: true, withdraw: true },
  bankTransfer: { deposit: false, withdraw: false },
  eTransfer: { deposit: false, withdraw: false },
  cryptoBtc: { deposit: false, withdraw: false },
  cryptoEth: { deposit: true, withdraw: false },
  cryptoMonero: { deposit: true, withdraw: true },
  cryptoOther: { deposit: false, withdraw: false },
};
