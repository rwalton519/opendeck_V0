// Shared between routers/wallet.js and admin/adminRouter.js - previously
// this mapping only existed inline in wallet.js, but admin's withdrawal
// approval now needs the same method->provider grouping to decide which
// real payout mechanism (if any) to use.

// frontend_new/src/types/wallet.ts's PaymentMethodType -> the provider
// implementations that actually exist (services/payments/*).
const METHOD_TO_PROVIDER = {
  card: 'stripe',
  debit: 'stripe',
  square: 'stripe',
  eWallet: 'stripe',
  bankTransfer: 'ach',
  eTransfer: 'ach',
  cryptoBtc: 'crypto',
  cryptoEth: 'crypto',
  cryptoMonero: 'crypto',
  cryptoOther: 'crypto',
};

// Of the crypto methods, only Monero has a real, complete withdrawal
// implementation anywhere in this codebase (services/payments/cryptoService.js,
// backed by monero-wallet-rpc). BTC/ETH/other have no real send/broadcast
// capability - services/wallet/usdcWallet.js can create a wallet and sign a
// transaction, but has no logic to construct a valid transaction (nonce,
// gas, etc.) or broadcast it.
const REAL_PAYOUT_CRYPTO_METHODS = new Set(['cryptoMonero']);

// ADDED (spec recommendation §6.2-6.3 / §12): "decide, before advertising
// ACH/bank-transfer or non-Monero crypto withdrawal as available, whether
// to build the missing infrastructure or remove those options from the
// product surface." Building real ACH bank-linking and real BTC/ETH
// transaction broadcast is substantial, separate scope - out of bounds for
// this fix pass. The decision made here instead: keep the existing honest
// 501 behavior on the affected routes, AND make per-method capability
// explicitly queryable (see routers/wallet.js's new GET
// /wallet/payment-methods/capabilities) so a client can discover and hide
// non-functional options instead of only finding out when a request fails.
// This is the single source of truth both that endpoint and the routes
// that reject unsupported methods should read from - if a method's real
// capability ever changes, it should only need to change here.
const PAYMENT_METHOD_CAPABILITIES = {
  card: { deposit: true, withdrawal: true, notes: 'Stripe. Withdrawal requires the user to complete Stripe Connect onboarding first.' },
  debit: { deposit: true, withdrawal: true, notes: 'Stripe. Withdrawal requires the user to complete Stripe Connect onboarding first.' },
  square: { deposit: true, withdrawal: true, notes: 'Stripe. Withdrawal requires the user to complete Stripe Connect onboarding first.' },
  eWallet: { deposit: true, withdrawal: true, notes: 'Stripe. Withdrawal requires the user to complete Stripe Connect onboarding first.' },
  bankTransfer: { deposit: false, withdrawal: false, notes: 'Not implemented - no bank-account-linking flow exists yet.' },
  eTransfer: { deposit: false, withdrawal: false, notes: 'Not implemented - no bank-account-linking flow exists yet.' },
  cryptoBtc: { deposit: false, withdrawal: false, notes: 'Not implemented - no address generation or send/broadcast logic exists yet.' },
  cryptoEth: { deposit: true, withdrawal: false, notes: 'Deposit address generation is real. Withdrawal (send) is not implemented.' },
  cryptoMonero: { deposit: true, withdrawal: true, notes: 'Fully implemented, including on-chain send for withdrawal.' },
  cryptoOther: { deposit: false, withdrawal: false, notes: 'Not implemented.' },
};

module.exports = { METHOD_TO_PROVIDER, REAL_PAYOUT_CRYPTO_METHODS, PAYMENT_METHOD_CAPABILITIES };
