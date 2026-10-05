const { Op } = require('sequelize');

// NOTE: same PaymentRecord-based logic as rulesAml.js - the original Python
// files (rules_velocity.py and rules_aml.py) are near-identical duplicates
// of each other too, preserved as separate classes here for fidelity.
const { PaymentRecord } = require('../../models/payment_models');

class VelocityRules {
  static async check(db, userId, amount) {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const totalSince = async (ts) => {
      const rows = await PaymentRecord.findAll({
        where: { user_id: userId, created_at: { [Op.gte]: ts } },
        attributes: ['amount'],
      });
      return rows.reduce((sum, r) => sum + Number(r.amount), 0);
    };

    const dailyTotal = await totalSince(dayAgo);
    const weeklyTotal = await totalSince(weekAgo);
    const monthlyTotal = await totalSince(monthAgo);

    const flags = [];

    if (dailyTotal + amount > VelocityRules.DAILY_LIMIT) {
      flags.push('daily_limit_exceeded');
    }
    if (weeklyTotal + amount > VelocityRules.WEEKLY_LIMIT) {
      flags.push('weekly_limit_exceeded');
    }
    if (monthlyTotal + amount > VelocityRules.MONTHLY_LIMIT) {
      flags.push('monthly_limit_exceeded');
    }

    return flags;
  }
}

VelocityRules.DAILY_LIMIT = 5000;
VelocityRules.WEEKLY_LIMIT = 20000;
VelocityRules.MONTHLY_LIMIT = 50000;

module.exports = VelocityRules;
