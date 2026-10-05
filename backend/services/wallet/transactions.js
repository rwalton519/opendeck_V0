// Converted from services/wallet/transactions.py - a tiny plain data holder
// class (distinct from the WalletTransaction Sequelize model and from
// services/wallet/ledger.js, which is what actually persists transactions).

class Transaction {
  constructor(userId, amount, method, status) {
    this.user_id = userId;
    this.amount = amount;
    this.method = method;
    this.status = status;
  }
}

module.exports = Transaction;
