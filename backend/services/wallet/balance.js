// Converted from services/wallet/balance.py - a tiny plain data holder class
// (not the WalletBalance Sequelize model from the other chunk; that's a
// separate, similarly-named class in the original Python too).

class Balance {
  constructor(userId, amount) {
    this.user_id = userId;
    this.amount = amount;
  }
}

module.exports = Balance;
