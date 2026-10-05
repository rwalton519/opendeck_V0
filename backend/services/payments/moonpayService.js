const axios = require('axios');

class MoonPayService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.moonpay.com/v3';
  }

  async getQuote(crypto, amountFiat) {
    const r = await axios.get(`${this.baseUrl}/prices/${crypto}`, {
      params: { apiKey: this.apiKey, fiatAmount: amountFiat },
    });
    return r.data;
  }

  async createTransaction(userId, crypto, walletAddress, amountFiat) {
    const payload = {
      walletAddress,
      currency: crypto,
      fiatAmount: amountFiat,
      externalCustomerId: userId,
    };
    const r = await axios.post(`${this.baseUrl}/transactions`, payload, {
      params: { apiKey: this.apiKey },
    });
    return r.data;
  }

  async getTransactionStatus(txId) {
    const r = await axios.get(`${this.baseUrl}/transactions/${txId}`, {
      params: { apiKey: this.apiKey },
    });
    return r.data;
  }
}

module.exports = MoonPayService;
