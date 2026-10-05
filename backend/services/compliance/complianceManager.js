// NOTE: app.models.compliance_models.ComplianceFlag - see the sibling
// chunk's models/compliance_models.js (Sequelize model).
const ComplianceFlag = require('../../models/compliance_models');
const User = require('../../models/user');

const VelocityRules = require('./rulesVelocity');
const AMLRules = require('./rulesAml');
const SanctionsRules = require('./rulesSanctions');
const FraudRules = require('./rulesFraud');

class ComplianceManager {
  static async flag(db, userId, rule, message) {
    const record = await ComplianceFlag.create({
      user_id: userId,
      rule,
      message,
      created_at: new Date(),
    });
    return record;
  }

  // ADDED (spec §5.7 / §9 / §12): POST /admin/freeze_user and
  // /admin/unfreeze_user called these methods before they existed anywhere
  // on this class - a straight runtime error. services/game/wsAuth.js
  // already had a defensive `if (user.is_frozen)` check written in
  // anticipation of this field existing - see its comment and the new
  // users.is_frozen column (models/user.js,
  // migrations/1745000500000_user-account-controls.js) this now relies on.
  //
  // Account-level freeze (blocks login/table access via wsAuth) is
  // deliberately a separate concept from WalletManager.freeze(), which
  // locks a specific dollar amount pending a single withdrawal - freezing a
  // user here does not touch their wallet balance at all.
  static async freezeUser(db, userId) {
    const user = await User.findByPk(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }
    user.is_frozen = true;
    await user.save();

    await ComplianceManager.flag(db, userId, 'admin:freeze', 'Account frozen by admin action');

    return { user_id: userId, is_frozen: true };
  }

  static async unfreezeUser(db, userId) {
    const user = await User.findByPk(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }
    user.is_frozen = false;
    await user.save();

    await ComplianceManager.flag(db, userId, 'admin:unfreeze', 'Account unfrozen by admin action');

    return { user_id: userId, is_frozen: false };
  }

  static async runChecks(db, userId, amount, userName = null) {
    const flags = [];

    // Velocity
    for (const f of await VelocityRules.check(db, userId, amount)) {
      flags.push(['velocity', f]);
    }

    // AML
    for (const f of await AMLRules.check(db, userId, amount)) {
      flags.push(['aml', f]);
    }

    // Sanctions
    for (const f of SanctionsRules.check(userName)) {
      flags.push(['sanctions', f]);
    }

    // Fraud
    for (const f of await FraudRules.check(db, userId, amount)) {
      flags.push(['fraud', f]);
    }

    // Store flags
    const stored = [];
    for (const [category, rule] of flags) {
      stored.push(
        // eslint-disable-next-line no-await-in-loop
        await ComplianceManager.flag(
          db,
          userId,
          `${category}:${rule}`,
          `Triggered rule: ${category}:${rule}`
        )
      );
    }

    return stored;
  }
}

module.exports = ComplianceManager;
