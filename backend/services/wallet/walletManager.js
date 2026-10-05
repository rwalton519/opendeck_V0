const Decimal = require('decimal.js');

// NOTE: app.models.real_money.WalletBalance - see the sibling chunk's
// models/real_money.js (Sequelize model).
const { WalletBalance } = require('../../models/real_money');
// FIXED: every method below mutates a balance but previously never wrote a
// matching row to wallet_transactions - see services/wallet/ledger.js. That
// meant GET /account/dashboard could only ever show Stripe deposit history
// (PaymentRecord rows), never buy-ins, cashouts, freezes, or payouts - the
// "previous debits and credits should be clearly visible" requirement was
// silently unmet for every real-money movement except card deposits. Each
// method now writes one immutable ledger entry per call, signed so a
// straight sum of a user's entries reproduces their balance history.
const Ledger = require('./ledger');

// IMPORTANT INTEGRATION NOTE (see README "Integration notes with earlier
// chunks"): this class's method signatures are POSITIONAL, matching the real
// Python source exactly:
//   get_balance(db, user_id)
//   credit(db, user_id, amount, reference=None)
//   debit(db, user_id, amount, reference=None)
//   freeze(db, user_id, amount, reason=None)
//   unfreeze(db, user_id, amount, reason=None)
//   finalize_locked(db, user_id, amount, reference=None)
//
// The first chunk you had converted (walletRouter.js, paymentRouter.js,
// adminRouter.js) was written *before* this file existed, so it speculatively
// called these methods with an options OBJECT (e.g.
// `WalletManager.credit(req.db, { userId, amount, reference })`) instead of
// positional arguments. Those call sites need a one-line update to match this
// real signature - see the README for the exact list.

class WalletManager {
  static async getBalance(db, userId) {
    let balance = await WalletBalance.findOne({ where: { user_id: userId } });
    if (!balance) {
      balance = await WalletBalance.create({ user_id: userId, available: 0, locked: 0 });
    }
    return balance;
  }

  static async credit(db, userId, amount, reference = null, type = 'credit') {
    const balance = await WalletManager.getBalance(db, userId);
    balance.available = new Decimal(balance.available).plus(new Decimal(amount)).toString();
    await balance.save();
    await Ledger.addEntry(db, userId, new Decimal(amount).toString(), type, reference);
    return balance;
  }

  static async debit(db, userId, amount, reference = null, type = 'debit') {
    const balance = await WalletManager.getBalance(db, userId);
    if (new Decimal(balance.available).lt(new Decimal(amount))) {
      throw new Error('Insufficient funds');
    }
    balance.available = new Decimal(balance.available).minus(new Decimal(amount)).toString();
    await balance.save();
    await Ledger.addEntry(db, userId, new Decimal(amount).negated().toString(), type, reference);
    return balance;
  }

  static async freeze(db, userId, amount, reason = null) {
    const balance = await WalletManager.getBalance(db, userId);
    if (new Decimal(balance.available).lt(new Decimal(amount))) {
      throw new Error('Insufficient funds to freeze');
    }
    balance.available = new Decimal(balance.available).minus(new Decimal(amount)).toString();
    balance.locked = new Decimal(balance.locked).plus(new Decimal(amount)).toString();
    await balance.save();
    // Moves money from available -> locked (total funds unchanged) - logged
    // as a negative entry against *available* balance so a player can see
    // exactly when/why funds became unavailable to spend (e.g. a cash-game
    // buy-in), even though nothing has actually left their account yet.
    await Ledger.addEntry(db, userId, new Decimal(amount).negated().toString(), 'freeze', reason);
    return balance;
  }

  static async unfreeze(db, userId, amount, reason = null) {
    const balance = await WalletManager.getBalance(db, userId);
    if (new Decimal(balance.locked).lt(new Decimal(amount))) {
      throw new Error('Insufficient locked funds');
    }
    balance.locked = new Decimal(balance.locked).minus(new Decimal(amount)).toString();
    balance.available = new Decimal(balance.available).plus(new Decimal(amount)).toString();
    await balance.save();
    await Ledger.addEntry(db, userId, new Decimal(amount).toString(), 'unfreeze', reason);
    return balance;
  }

  static async finalizeLocked(db, userId, amount, reference = null) {
    const balance = await WalletManager.getBalance(db, userId);
    if (new Decimal(balance.locked).lt(new Decimal(amount))) {
      throw new Error('Insufficient locked funds');
    }
    balance.locked = new Decimal(balance.locked).minus(new Decimal(amount)).toString();
    await balance.save();
    // Locked funds leaving for good (a cash-game loss, a tournament buy-in
    // being spent, etc.) - a real debit of total account funds, unlike
    // freeze/unfreeze above which only move money between available/locked.
    await Ledger.addEntry(db, userId, new Decimal(amount).negated().toString(), 'finalize_locked', reference);
    return balance;
  }
}

module.exports = WalletManager;
