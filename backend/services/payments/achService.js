const stripe = require('stripe')(process.env.STRIPE_API_KEY);

// Converted from services/payments/ach_service.py. Same hardcoded-secret
// note as stripeService.js applies here too.

class StripeACHService {
  /**
   * Debit a user's linked bank account using Stripe ACH Direct Debit.
   *
   * @param {string} customerId - Stripe customer ID
   * @param {number|string} amount - USD amount (e.g. 25.00)
   * @param {string} paymentMethodId - Financial Connections ACH payment method ID
   */
  async debit(customerId, amount, paymentMethodId) {
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.trunc(amount * 100), // cents
        currency: 'usd',
        customer: customerId,
        payment_method: paymentMethodId,
        payment_method_types: ['us_bank_account'],
        confirm: true,
        mandate_data: {
          customer_acceptance: {
            type: 'online',
            online: {
              ip_address: '127.0.0.1', // replace with real client IP
              user_agent: 'your-app-name',
            },
          },
        },
        description: 'Prediction market account funding',
      });

      return {
        status: 'ach_debit_initiated',
        payment_intent_id: paymentIntent.id,
        client_secret: paymentIntent.client_secret,
        stripe_status: paymentIntent.status,
      };
    } catch (e) {
      return {
        status: 'error',
        message: e.message,
      };
    }
  }

  // eslint-disable-next-line class-methods-use-this
  async credit(userId, amount) {
    return { status: 'ach_credit_initiated' };
  }
}

module.exports = StripeACHService;
