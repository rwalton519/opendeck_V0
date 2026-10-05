const axios = require('axios');

// Converted from services/payments/crypto_service.py, which used the Python
// `monero` package (a wrapper around the monero-wallet-rpc JSON-RPC
// interface). There's no equivalent maintained Node package, so this talks
// to the same monero-wallet-rpc JSON-RPC endpoint directly. FLAGGED
// ASSUMPTION: the exact RPC method names/response shapes below
// (`create_address`, `get_transfer_by_txid`, `transfer`) follow the
// documented monero-wallet-rpc JSON-RPC API and are a best-effort
// translation of what the Python `monero` library does internally - this
// hasn't been tested against a live wallet RPC daemon and should be verified.

class CryptoService {
  constructor() {
    this.rpcUrl = `http://${process.env.MONERO_RPC_HOST || 'localhost'}:${
      process.env.MONERO_RPC_PORT || 18082
    }/json_rpc`;
    this.auth = {
      username: process.env.MONERO_RPC_USER || 'username',
      password: process.env.MONERO_RPC_PASSWORD || 'password',
    };
  }

  async _call(method, params = {}) {
    const res = await axios.post(
      this.rpcUrl,
      { jsonrpc: '2.0', id: '0', method, params },
      { auth: this.auth }
    );
    return res.data.result;
  }

  async generateDepositAddress(userId, currency = 'XMR') {
    const result = await this._call('create_address', {
      account_index: 0,
      label: `user_${userId}`,
    });

    return {
      address: result.address,
      address_index: result.address_index,
      currency,
    };
  }

  /**
   * Check transaction confirmation status.
   */
  async checkConfirmations(txid) {
    try {
      const result = await this._call('get_transfer_by_txid', { txid });
      const tx = result && result.transfer;

      if (!tx) {
        return {
          status: 'not_found',
          txid,
        };
      }

      return {
        status: tx.confirmations >= 10 ? 'confirmed' : 'pending',
        txid: tx.txid,
        confirmations: tx.confirmations,
        amount: tx.amount / 1e12, // atomic units -> XMR
        fee: tx.fee / 1e12,
        height: tx.height,
        timestamp: tx.timestamp ? new Date(tx.timestamp * 1000).toISOString() : null,
      };
    } catch (e) {
      return {
        status: 'error',
        message: e.message,
      };
    }
  }

  /**
   * Send XMR withdrawal.
   */
  async sendWithdrawal(userId, amount, address) {
    try {
      const result = await this._call('transfer', {
        destinations: [{ amount: Math.round(Number(amount) * 1e12), address }],
        priority: 1,
      });

      return {
        status: 'withdrawal_sent',
        user_id: userId,
        txid: result.tx_hash,
        amount: Number(amount),
        fee: result.fee / 1e12,
        address,
      };
    } catch (e) {
      return {
        status: 'error',
        message: e.message,
      };
    }
  }
}

module.exports = CryptoService;
