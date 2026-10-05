const { DataTypes } = require('sequelize');
const sequelize = require('../db/sequelize');

const PaymentStatus = Object.freeze({
  pending: 'pending',
  completed: 'completed',
  failed: 'failed',
});

// Converted from models/payment_models.py:
//
//   class PaymentRecord(Base):
//       __tablename__ = "payment_records"
//       id, user_id, provider, amount, status (Enum PaymentStatus), external_id, created_at

const PaymentRecord = sequelize.define(
  'PaymentRecord',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.STRING, allowNull: false },
    provider: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.DECIMAL(18, 2), allowNull: false },
    status: { type: DataTypes.ENUM(...Object.values(PaymentStatus)), defaultValue: PaymentStatus.pending },
    external_id: { type: DataTypes.STRING, allowNull: true },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    // FIXED: was missing entirely - PaymentManager.refreshStatus() sets
    // record.updated_at, which Sequelize silently drops on .save() without
    // a matching column defined here. Flagged in the services-chunk README;
    // added now that everything's being merged.
    updated_at: { type: DataTypes.DATE, allowNull: true },
  },
  { tableName: 'payment_records', timestamps: false }
);

module.exports = { PaymentStatus, PaymentRecord };
