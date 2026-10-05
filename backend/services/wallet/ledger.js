const Decimal = require('decimal.js');

// NOTE: app.models.real_money.WalletTransaction - see the sibling chunk's
// models/real_money.js (Sequelize model).
const { WalletTransaction } = require('../../models/real_money');

class Ledger {
  /**
   * Immutable ledger entry. Every movement of money is recorded here.
   */
  static async addEntry(db, userId, amount, entryType, reference = null) {
    const tx = await WalletTransaction.create({
      user_id: userId,
      amount,
      type: entryType,
      created_at: new Date(),
      reference,
    });
    return tx;
  }

  static async getUserTransactions(db, userId, limit = 100) {
    return WalletTransaction.findAll({
      where: { user_id: userId },
      order: [['created_at', 'DESC']],
      limit,
    });
  }

  /**
   * Reconstructs balance from ledger entries. Used for audits/reconciliation.
   */
  static async calculateBalance(db, userId) {
    const rows = await WalletTransaction.findAll({
      where: { user_id: userId },
      attributes: ['amount'],
    });
    return rows.reduce((total, row) => total.plus(new Decimal(row.amount)), new Decimal('0.00'));
  }
}

module.exports = Ledger;
