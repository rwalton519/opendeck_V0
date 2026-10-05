const KYCProviderBase = require('./providerBase');

class OnfidoProvider extends KYCProviderBase {
  startVerification(userId) {
    return {
      provider: 'onfido',
      external_id: `onfido-${userId}`,
      status: 'pending',
    };
  }

  getStatus(externalId) {
    return {
      provider: 'onfido',
      external_id: externalId,
      status: 'verified',
    };
  }
}

module.exports = OnfidoProvider;
