const PaymentProviderBase = require('./providerBase');

// NOTE: this is deliberately NOT wired to achService.js the way
// providerStripe.js was wired to stripeService.js. achService.debit()
// requires a Stripe `customerId` and a Financial Connections
// `paymentMethodId` (a linked bank account token) - neither of which this
// codebase has anywhere to obtain. There's no "link your bank account" flow
// (Stripe Financial Connections onboarding) built on the frontend or
// backend. Fabricating placeholder values to make this "work" would create
// a payment method that either fails at Stripe's API or, worse, silently
// succeeds against a wrong/test account - so this throws a clear, honest
// error instead of a fake success.
//
// To make this real: build a bank-linking flow (Stripe Financial
// Connections on the frontend), store the resulting customerId/
// paymentMethodId per user (e.g. on the PaymentMethod model, which already
// exists and already has the right shape - provider/details columns), and
// then this class can call achService.debit(customerId, amount,
// paymentMethodId) with real values.
class ACHProvider extends PaymentProviderBase {
  // eslint-disable-next-line class-methods-use-this
  async createDeposit(userId, amount) {
    const err = new Error(
      'ACH deposits require a linked bank account. Bank-account linking (Stripe Financial Connections) is not yet implemented in this codebase.'
    );
    err.statusCode = 501;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  async createWithdrawal(userId, amount) {
    const err = new Error(
      'ACH withdrawals require a linked bank account. Bank-account linking (Stripe Financial Connections) is not yet implemented in this codebase.'
    );
    err.statusCode = 501;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  async getStatus(externalId) {
    const err = new Error('ACH provider has no real deposits/withdrawals to check status for yet.');
    err.statusCode = 501;
    throw err;
  }
}

module.exports = ACHProvider;
