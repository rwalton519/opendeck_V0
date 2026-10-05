const KYCManager = require('../kyc/kycManager');

/**
 * Checks per-deposit limits using the configured KYC policy.
 *
 * The previous version called a nonexistent KYCManager.getLimits() method,
 * so every invocation failed with a TypeError. KYCManager now owns the
 * policy lookup; it is configuration-backed because the supplied source does
 * not define numeric KYC tier thresholds. Missing/malformed policy fails
 * closed with an actionable configuration error instead of silently allowing
 * an unbounded deposit.
 */
class LimitChecker {
  async checkDeposit(user, amount) {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 0) {
      return false;
    }

    const tierLimits = KYCManager.getLimits(user && user.kyc_tier);
    return numericAmount <= tierLimits.deposit;
  }

  // eslint-disable-next-line class-methods-use-this
  async checkWithdraw(user, amount) {
    return true;
  }
}

module.exports = LimitChecker;
