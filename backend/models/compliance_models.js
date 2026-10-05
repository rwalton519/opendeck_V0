const { DataTypes } = require('sequelize');
const sequelize = require('../db/sequelize');

// Converted from models/compliance_models.py:
//
//   class ComplianceFlag(Base):
//       __tablename__ = "compliance_flags"
//       id, user_id, rule, message, created_at, resolved

const ComplianceFlag = sequelize.define(
  'ComplianceFlag',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.STRING, allowNull: false },
    rule: { type: DataTypes.STRING, allowNull: false },
    message: { type: DataTypes.STRING, allowNull: false },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    resolved: { type: DataTypes.BOOLEAN, defaultValue: false },
  },
  { tableName: 'compliance_flags', timestamps: false }
);

module.exports = ComplianceFlag;
