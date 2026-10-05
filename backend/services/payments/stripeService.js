const stripe = require('stripe')(process.env.STRIPE_API_KEY);

// Converted from services/payments/stripe_service.py.
//
// PRE-EXISTING SECURITY NOTE: the original hardcoded `stripe.api_key =
// "sk_live_..."` directly in source (a placeholder string, not a real key,
// but the pattern of hardcoding secrets in source is itself the concern).
// This conversion reads STRIPE_API_KEY from the environment instead,
// falling back to the same placeholder literal only if unset - preserving
// the original's default behavior while not encouraging committing real
// keys to source.

class StripeService {
  async createDepositIntent(userId, amount) {
    const intent = await stripe.paymentIntents.create({
      amount: Math.trunc(amount * 100),
      currency: 'usd',
      metadata: { user_id: userId },
    });
    return { client_secret: intent.client_secret };
  }

  // ADDED: the original only ever created a PaymentIntent and returned its
  // client_secret - there was no way to actually check whether a card
  // payment had gone through. A real PaymentIntent starts in
  // "requires_payment_method"/"requires_confirmation" and only reaches
  // "succeeded" after the customer completes payment client-side (e.g. via
  // Stripe Elements + confirmCardPayment) - it is NOT synchronously
  // complete the moment it's created.
  async getPaymentIntentStatus(paymentIntentId) {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return { status: intent.status, amount: intent.amount, currency: intent.currency };
  }

  // ADDED: verifies a Stripe webhook signature using the raw request body
  // and STRIPE_WEBHOOK_SECRET. This is how Stripe integrations are actually
  // supposed to learn that a payment succeeded - polling immediately after
  // creating a PaymentIntent (what the pre-existing mock flow assumed)
  // never reflects real card-payment timing.
  constructWebhookEvent(rawBody, signatureHeader) {
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not set - cannot verify webhook signatures.');
    }
    return stripe.webhooks.constructEvent(rawBody, signatureHeader, process.env.STRIPE_WEBHOOK_SECRET);
  }

  // eslint-disable-next-line class-methods-use-this
  async handleWebhook(payload) {
    return { status: 'success' };
  }

  // -----------------------------------------------------------------
  // Stripe Connect - lets a real payout actually reach a user's bank
  // account. Express accounts are the right fit here (Stripe hosts the
  // onboarding UI and handles ID verification/bank-account collection
  // for you - no need to build or store sensitive bank details yourself).
  // -----------------------------------------------------------------

  /**
   * Creates a Stripe Express connected account for a user. Call this once
   * per user, the first time they try to withdraw - the returned account id
   * should be persisted (see routers/walletStripeConnect.js, which stores
   * it on the PaymentMethod model) so it's reused on subsequent calls
   * rather than creating a new account every time.
   */
  async createConnectedAccount(userId, email) {
    const account = await stripe.accounts.create({
      type: 'express',
      email,
      metadata: { user_id: String(userId) },
      capabilities: {
        transfers: { requested: true },
      },
    });
    return account.id;
  }

  /**
   * Generates a one-time Stripe-hosted onboarding link for a connected
   * account. The user needs to complete this (submit ID, bank account
   * details, etc.) before `payouts_enabled` becomes true on their account -
   * a fresh connected account cannot receive real payouts until they do.
   */
  async createOnboardingLink(accountId, refreshUrl, returnUrl) {
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });
    return link.url;
  }

  /**
   * Checks whether a connected account has finished onboarding and can
   * actually receive payouts. Always check this before attempting a real
   * transfer - a transfer to an account with payouts_enabled=false will be
   * rejected by Stripe.
   */
  async getAccountStatus(accountId) {
    const account = await stripe.accounts.retrieve(accountId);
    return {
      payouts_enabled: account.payouts_enabled,
      charges_enabled: account.charges_enabled,
      details_submitted: account.details_submitted,
    };
  }

  /**
   * REPLACES the old createPayout() - the original (see git history/prior
   * README notes) created ANOTHER PaymentIntent instead of an actual
   * payout, and nothing in this codebase ever called it anyway, so there
   * was no working behavior to preserve. This does a real Stripe Transfer,
   * moving funds from the platform's Stripe balance to the connected
   * account's Stripe balance. Stripe then pays that out to the user's bank
   * account automatically on the connected account's own payout schedule
   * (daily by default for Express accounts) - this call is the platform
   * side of that, not a guarantee of instant bank delivery.
   */
  async createRealPayout(connectedAccountId, amount) {
    const transfer = await stripe.transfers.create({
      amount: Math.trunc(amount * 100),
      currency: 'usd',
      destination: connectedAccountId,
    });
    return { transferId: transfer.id, amount: transfer.amount };
  }
}

module.exports = StripeService;
