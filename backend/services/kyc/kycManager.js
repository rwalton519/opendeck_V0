// NOTE: app.models.kyc_models.{KYCRecord, KYCState} - see the sibling
// chunk's models/kyc_models.js (Sequelize model + enum).
const { KYCRecord, KYCState } = require('../../models/kyc_models');

const SumSubProvider = require('./providerSumsub');
const OnfidoProvider = require('./providerOnfido');

class KYCManager {
  static async getOrCreateRecord(db, userId) {
    let record = await KYCRecord.findOne({ where: { user_id: userId } });
    if (!record) {
      record = await KYCRecord.create({ user_id: userId, state: KYCState.unverified });
    }
    return record;
  }

  static async startVerification(db, userId, provider = null) {
    provider = provider || KYCManager.DEFAULT_PROVIDER;
    if (!(provider in KYCManager.PROVIDERS)) {
      throw new Error('Invalid KYC provider');
    }

    const record = await KYCManager.getOrCreateRecord(db, userId);

    const providerImpl = KYCManager.PROVIDERS[provider];
    const result = providerImpl.startVerification(userId);

    record.provider = provider;
    record.external_id = result.external_id;
    record.state = KYCState.pending;
    record.updated_at = new Date();

    await record.save();
    return record;
  }

  /**
   * Returns the configured deposit limits for a KYC tier.
   *
   * The previous implementation called this method from LimitChecker even
   * though it did not exist, causing a TypeError on every checkDeposit call.
   * The source material does not define a numeric tier policy, so this method
   * deliberately does not invent regulatory thresholds. Instead, production
   * limits are supplied through KYC_DEPOSIT_LIMITS_JSON and the checker fails
   * closed when that policy is missing or malformed.
   *
   * Example: {"unverified":0,"verified":5000}
   */
  static getLimits(kycTier) {
    const raw = process.env.KYC_DEPOSIT_LIMITS_JSON;
    if (!raw) {
      throw new Error('KYC_DEPOSIT_LIMITS_JSON is not configured');
    }

    let limits;
    try {
      limits = JSON.parse(raw);
    } catch {
      throw new Error('KYC_DEPOSIT_LIMITS_JSON must be valid JSON');
    }

    if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
      throw new Error('KYC_DEPOSIT_LIMITS_JSON must be a JSON object');
    }

    const tier = kycTier == null || kycTier === '' ? 'unverified' : String(kycTier);
    const tierLimits = limits[tier];
    if (!tierLimits || typeof tierLimits !== 'object' || Array.isArray(tierLimits)) {
      throw new Error(`No deposit limit configured for KYC tier: ${tier}`);
    }

    const deposit = Number(tierLimits.deposit);
    if (!Number.isFinite(deposit) || deposit < 0) {
      throw new Error(`Invalid deposit limit configured for KYC tier: ${tier}`);
    }

    return { ...tierLimits, deposit };
  }

  static async refreshStatus(db, userId) {
    const record = await KYCManager.getOrCreateRecord(db, userId);

    if (!record.external_id || !record.provider) {
      throw new Error('KYC not started');
    }

    const providerImpl = KYCManager.PROVIDERS[record.provider];
    const result = providerImpl.getStatus(record.external_id);

    if (result.status === 'verified') {
      record.state = KYCState.verified;
    } else if (result.status === 'rejected') {
      record.state = KYCState.rejected;
    } else {
      record.state = KYCState.pending;
    }

    record.updated_at = new Date();
    await record.save();
    return record;
  }
}

KYCManager.PROVIDERS = {
  sumsub: new SumSubProvider(),
  onfido: new OnfidoProvider(),
};
KYCManager.DEFAULT_PROVIDER = 'sumsub';

module.exports = KYCManager;
