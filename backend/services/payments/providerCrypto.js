const PaymentProviderBase = require('./providerBase');

// NOTE: crypto genuinely doesn't fit PaymentManager's "createDeposit(userId,
// amount) -> instantly initiated, poll for completion" pattern the way
// card/ACH payments do. A crypto deposit works by generating a stable
// address, having the user send an on-chain transaction of unknown-until-
// sent amount, and waiting for confirmations - there's no "amount" to pass
// upfront and no synchronous provider call that "creates" a deposit.
//
// The REAL, working crypto deposit flow lives in routers/wallet.js:
//   - GET /wallet/crypto-deposit-address (generates/persists a real address
//     via services/wallet/usdcWallet.js for ETH or
//     services/payments/cryptoService.js for XMR)
//   - POST /wallet/crypto-deposit-confirm (calls cryptoService.checkConfirmations()
//     against a real txid and credits the wallet once confirmed)
//
// This class exists only because PaymentManager.PROVIDERS needs a "crypto"
// entry for method-mapping purposes elsewhere - it deliberately fails fast
// with a message pointing at the real flow rather than pretending the
// generic deposit/withdraw pattern applies here.
class CryptoProvider extends PaymentProviderBase {
  // eslint-disable-next-line class-methods-use-this
  async createDeposit(userId, amount) {
    const err = new Error(
      'Crypto deposits do not go through this endpoint. Use GET /wallet/crypto-deposit-address to get a deposit address, then POST /wallet/crypto-deposit-confirm once you have a transaction id.'
    );
    err.statusCode = 400;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  async createWithdrawal(userId, amount) {
    const err = new Error(
      'Crypto withdrawals need a destination address, which this generic endpoint does not collect. Not yet wired to a dedicated crypto withdrawal endpoint.'
    );
    err.statusCode = 501;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  async getStatus(externalId) {
    const err = new Error('Use POST /wallet/crypto-deposit-confirm with a real txid instead.');
    err.statusCode = 400;
    throw err;
  }
}

module.exports = CryptoProvider;
