class FraudRules {
  // eslint-disable-next-line no-unused-vars
  static async check(db, userId, amount) {
    const flags = [];

    // Example: tiny deposits followed by large withdrawal
    if (amount < 5) {
      flags.push('micro_deposit_pattern');
    }

    return flags;
  }
}

module.exports = FraudRules;
