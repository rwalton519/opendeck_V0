const KYCProviderBase = require('./providerBase');

class SumSubProvider extends KYCProviderBase {
  startVerification(userId) {
    // In production: call SumSub API
    return {
      provider: 'sumsub',
      external_id: `sumsub-${userId}`,
      status: 'pending',
    };
  }

  getStatus(externalId) {
    // In production: call SumSub API
    return {
      provider: 'sumsub',
      external_id: externalId,
      status: 'verified',
    };
  }
}

module.exports = SumSubProvider;
