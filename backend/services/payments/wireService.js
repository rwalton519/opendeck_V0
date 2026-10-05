const ModernTreasury = require('modern-treasury').default;

const client = new ModernTreasury({
  apiKey: process.env.MODERN_TREASURY_API_KEY,
  organizationId: process.env.MODERN_TREASURY_ORG_ID,
});

class ModernTreasuryWireService {
  /**
   * Initiate an outbound domestic wire transfer via Modern Treasury.
   *
   * @param {string} counterpartyId - Modern Treasury counterparty ID
   * @param {number|string} amount - USD amount
   * @param {string} description - Transfer description
   */
  async initiateWire(counterpartyId, amount, description = 'Prediction market withdrawal') {
    try {
      const paymentOrder = await client.paymentOrders.create({
        type: 'wire',
        direction: 'credit',
        amount: Math.trunc(amount * 100), // cents
        currency: 'USD',
        counterparty_id: counterpartyId,
        description,
        ledger_transaction: {
          description,
        },
      });

      return {
        status: 'wire_pending',
        payment_order_id: paymentOrder.id,
        state: paymentOrder.status,
        amount: paymentOrder.amount,
        currency: paymentOrder.currency,
      };
    } catch (e) {
      return {
        status: 'error',
        message: e.message,
      };
    }
  }
}

module.exports = ModernTreasuryWireService;
