const { DataTypes } = require('sequelize');
const sequelize = require('../db/sequelize');

const KYCState = Object.freeze({
  unverified: 'unverified',
  pending: 'pending',
  verified: 'verified',
  rejected: 'rejected',
});

// Converted from models/kyc_models.py:
//
//   class KYCRecord(Base):
//       __tablename__ = "kyc_records"
//       id, user_id (unique), provider, state (Enum KYCState), external_id, updated_at

const KYCRecord = sequelize.define(
  'KYCRecord',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.STRING, allowNull: false, unique: true },
    provider: { type: DataTypes.STRING, allowNull: true },
    state: { type: DataTypes.ENUM(...Object.values(KYCState)), defaultValue: KYCState.unverified },
    external_id: { type: DataTypes.STRING, allowNull: true },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { tableName: 'kyc_records', timestamps: false }
);

module.exports = { KYCState, KYCRecord };
