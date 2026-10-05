const PaymentProviderBase = require('./providerBase');
const StripeService = require('./stripeService');
const { PaymentMethod } = require('../../models/real_money');

const stripeService = new StripeService();

// REWIRED: this used to return hardcoded fake data
// (`external_id: "stripe-dep-" + userId`, no real API call at all) - which
// meant a real STRIPE_API_KEY in .env did nothing for the endpoint the
// frontend actually calls (PaymentManager -> this class). Now calls the
// real Stripe SDK wrapper.
class StripeProvider extends PaymentProviderBase {
  async createDeposit(userId, amount) {
    const { client_secret: clientSecret } = await stripeService.createDepositIntent(userId, amount);

    // A PaymentIntent's id is embedded in its client_secret
    // (format: "pi_XXXX_secret_YYYY") - extract it so PaymentManager can
    // store a real external_id to look the intent up by later.
    const paymentIntentId = clientSecret.split('_secret_')[0];

    return {
      provider: 'stripe',
      external_id: paymentIntentId,
      client_secret: clientSecret,
      // A fresh PaymentIntent is NOT complete yet - it needs the customer
      // to actually enter card details client-side (Stripe Elements +
      // confirmCardPayment) before it can succeed. Reporting "pending" here
      // (not "completed") is what makes PaymentManager.deposit() correctly
      // leave the wallet uncredited until the real webhook confirms it.
      status: 'pending',
    };
  }

  /**
   * Real payout, now that Stripe Connect exists (see stripeService.js).
   * Requires the user to have already onboarded a connected account via
   * POST /wallet/stripe-connect/onboard - if they haven't, or haven't
   * finished Stripe's onboarding flow yet, this throws a clear error
   * rather than silently pretending money moved.
   */
  async createWithdrawal(userId, amount) {
    const connectAccount = await PaymentMethod.findOne({
      where: { user_id: userId, provider: 'stripe_connect', active: true },
    });

    if (!connectAccount) {
      const err = new Error(
        'No Stripe Connect account on file for this user. Call POST /wallet/stripe-connect/onboard first.'
      );
      err.statusCode = 400;
      throw err;
    }

    const status = await stripeService.getAccountStatus(connectAccount.details);
    if (!status.payouts_enabled) {
      const err = new Error(
        'Stripe Connect onboarding is not complete yet for this user - payouts are not enabled on their account. Have them finish onboarding (GET /wallet/stripe-connect/status for a fresh onboarding link if needed).'
      );
      err.statusCode = 400;
      throw err;
    }

    const payout = await stripeService.createRealPayout(connectAccount.details, amount);

    return {
      provider: 'stripe',
      external_id: payout.transferId,
      // A Stripe Transfer to a connected account succeeds or fails
      // synchronously (unlike a card PaymentIntent) - if createRealPayout()
      // didn't throw, the funds have genuinely moved to the connected
      // account's Stripe balance. Stripe pays that out to their bank on its
      // own schedule from there.
      status: 'completed',
    };
  }

  async getStatus(externalId) {
    const result = await stripeService.getPaymentIntentStatus(externalId);
    // Map Stripe's real PaymentIntent statuses onto the small vocabulary
    // PaymentManager.refreshStatus() understands ("completed"/"failed"/
    // anything else -> pending).
    let status = 'pending';
    if (result.status === 'succeeded') status = 'completed';
    else if (result.status === 'canceled') status = 'failed';
    return { provider: 'stripe', external_id: externalId, status };
  }
}

module.exports = StripeProvider;
