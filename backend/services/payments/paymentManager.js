// NOTE: app.models.payment_models.{PaymentRecord, PaymentStatus} - see the
// sibling chunk's models/payment_models.js (Sequelize model + enum).
const { PaymentRecord, PaymentStatus } = require('../../models/payment_models');

const StripeProvider = require('./providerStripe');
const ACHProvider = require('./providerAch');
const CryptoProvider = require('./providerCrypto');

class PaymentManager {
  static async createPaymentRecord(db, userId, provider, amount) {
    const record = await PaymentRecord.create({
      user_id: userId,
      provider,
      amount,
      status: PaymentStatus.pending,
    });
    return record;
  }

  /**
   * Returns { record, providerResult } rather than just `record` - callers
   * (routers/wallet.js) need providerResult's extra fields (e.g. Stripe's
   * client_secret, needed for the frontend to actually complete a card
   * payment) that don't belong on the persisted PaymentRecord itself.
   */
  static async deposit(db, userId, amount, provider = null) {
    provider = provider || PaymentManager.DEFAULT_PROVIDER;
    const providerImpl = PaymentManager.PROVIDERS[provider];

    const record = await PaymentManager.createPaymentRecord(db, userId, provider, amount);

    // FIXED: was missing `await` - harmless while every provider was a
    // synchronous stub returning a plain object, but the real providers
    // (providerStripe.js etc.) are now genuinely async (real API calls), so
    // this would have set external_id to a Promise object instead of the
    // real id without this fix.
    const result = await providerImpl.createDeposit(userId, amount);

    record.external_id = result.external_id;
    await record.save();
    return { record, providerResult: result };
  }

  static async withdraw(db, userId, amount, provider = null) {
    provider = provider || PaymentManager.DEFAULT_PROVIDER;
    const providerImpl = PaymentManager.PROVIDERS[provider];

    const record = await PaymentManager.createPaymentRecord(db, userId, provider, amount);
    const result = await providerImpl.createWithdrawal(userId, amount); // FIXED: missing await, same as deposit()

    record.external_id = result.external_id;
    await record.save();
    return { record, providerResult: result };
  }

  static async refreshStatus(db, recordId, userId = null) {
    const where = { id: recordId };
    if (userId != null) where.user_id = String(userId);

    const record = await PaymentRecord.findOne({ where });
    if (!record) {
      throw new Error('Payment record not found');
    }

    const providerImpl = PaymentManager.PROVIDERS[record.provider];
    const result = await providerImpl.getStatus(record.external_id); // FIXED: missing await, same as deposit()

    if (result.status === 'completed') {
      record.status = PaymentStatus.completed;
    } else if (result.status === 'failed') {
      record.status = PaymentStatus.failed;
    } else {
      record.status = PaymentStatus.pending;
    }

    record.updated_at = new Date();
    await record.save();
    return record;
  }
}

PaymentManager.PROVIDERS = {
  stripe: new StripeProvider(),
  ach: new ACHProvider(),
  crypto: new CryptoProvider(),
};
PaymentManager.DEFAULT_PROVIDER = 'stripe';

module.exports = PaymentManager;
