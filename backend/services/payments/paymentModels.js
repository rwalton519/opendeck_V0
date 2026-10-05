// Converted from services/payments/payment_models.py - a tiny plain data
// holder class (distinct from app.models.payment_models.PaymentRecord, the
// actual Sequelize model in the sibling chunk, which PaymentManager uses).

class PaymentRecord {
  constructor(userId, amount, method, status) {
    this.user_id = userId;
    this.amount = amount;
    this.method = method;
    this.status = status;
  }
}

module.exports = PaymentRecord;
