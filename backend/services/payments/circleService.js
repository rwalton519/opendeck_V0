const axios = require('axios');

class CircleService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.circle.com/v1';
  }

  _headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async createCardPayment(userId, amount, currency = 'USD') {
    const payload = {
      amount: { amount: String(amount), currency },
      metadata: { userId },
    };
    const r = await axios.post(`${this.baseUrl}/payments`, payload, { headers: this._headers() });
    return r.data;
  }

  async createUsdcTransfer(fromAddr, toAddr, amount) {
    const payload = {
      source: { type: 'blockchain', address: fromAddr },
      destination: { type: 'blockchain', address: toAddr },
      amount: { amount: String(amount), currency: 'USD' },
    };
    const r = await axios.post(`${this.baseUrl}/transfers`, payload, { headers: this._headers() });
    return r.data;
  }

  async getPaymentStatus(paymentId) {
    const r = await axios.get(`${this.baseUrl}/payments/${paymentId}`, { headers: this._headers() });
    return r.data;
  }
}

module.exports = CircleService;
