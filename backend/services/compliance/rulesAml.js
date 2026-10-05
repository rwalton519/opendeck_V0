const { Op } = require('sequelize');

// NOTE: app.models.payment_models.PaymentRecord - see the sibling chunk's
// models/payment_models.js (Sequelize model).
const { PaymentRecord } = require('../../models/payment_models');

class AMLRules {
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

    if (dailyTotal + amount > AMLRules.DAILY_LIMIT) {
      flags.push('daily_limit_exceeded');
    }
    if (weeklyTotal + amount > AMLRules.WEEKLY_LIMIT) {
      flags.push('weekly_limit_exceeded');
    }
    if (monthlyTotal + amount > AMLRules.MONTHLY_LIMIT) {
      flags.push('monthly_limit_exceeded');
    }

    return flags;
  }
}

AMLRules.DAILY_LIMIT = 5000;
AMLRules.WEEKLY_LIMIT = 20000;
AMLRules.MONTHLY_LIMIT = 50000;

module.exports = AMLRules;
