// Converted from services/payments/provider_base.py - abstract interface for
// all payment providers.

class PaymentProviderBase {
  // eslint-disable-next-line no-unused-vars
  createDeposit(userId, amount) {
    throw new Error('Not implemented');
  }

  // eslint-disable-next-line no-unused-vars
  createWithdrawal(userId, amount) {
    throw new Error('Not implemented');
  }

  // eslint-disable-next-line no-unused-vars
  getStatus(externalId) {
    throw new Error('Not implemented');
  }
}

module.exports = PaymentProviderBase;
