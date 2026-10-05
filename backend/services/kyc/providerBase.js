class KYCProviderBase {
  // eslint-disable-next-line no-unused-vars
  startVerification(userId) {
    throw new Error('Not implemented');
  }

  // eslint-disable-next-line no-unused-vars
  getStatus(externalId) {
    throw new Error('Not implemented');
  }
}

module.exports = KYCProviderBase;
