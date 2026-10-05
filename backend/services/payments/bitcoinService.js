const axios = require('axios');

class BitcoinService {
  constructor() {
    this.url = process.env.BTC_RPC_URL;
    this.auth = { username: process.env.BTC_RPC_USER, password: process.env.BTC_RPC_PASSWORD };
  }

  async call(method, params = []) {
    if (!this.url || !process.env.BTC_RPC_USER || !process.env.BTC_RPC_PASSWORD) {
      throw new Error('BTC_RPC_URL, BTC_RPC_USER, and BTC_RPC_PASSWORD are required.');
    }
    const suffix = process.env.BTC_WALLET_NAME ? `/wallet/${encodeURIComponent(process.env.BTC_WALLET_NAME)}` : '';
    const response = await axios.post(`${this.url.replace(/\/$/, '')}${suffix}`, { jsonrpc: '1.0', id: 'opendeck', method, params }, { auth: this.auth });
    if (response.data.error) throw new Error(response.data.error.message);
    return response.data.result;
  }

  async generateDepositAddress(userId) { return { address: await this.call('getnewaddress', [`opendeck:${userId}`, 'bech32']) }; }
  async getDeposit(address) {
    const rows = await this.call('listreceivedbyaddress', [0, true, true]);
    const row = rows.find((item) => item.address === address);
    if (!row || !row.txids || !row.txids.length) return { status: 'watching', confirmations: 0 };
    const txid = row.txids[0];
    const tx = await this.call('gettransaction', [txid]);
    return { status: tx.confirmations >= Number(process.env.BTC_REQUIRED_CONFIRMATIONS || 6) ? 'confirmed' : 'pending', txid, amount: Math.abs(Number(tx.amount)), confirmations: tx.confirmations || 0 };
  }
  async sendWithdrawal(address, amount) {
    const txid = await this.call('sendtoaddress', [address, Number(amount)]);
    return { status: 'withdrawal_sent', txid };
  }
}
module.exports = BitcoinService;
