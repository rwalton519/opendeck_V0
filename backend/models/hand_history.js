const { DataTypes } = require('sequelize');
const sequelize = require('../db/sequelize');

// Converted from models/hand_history.py:
//
//   class HandHistory(Base):
//       __tablename__ = "hand_history"
//       id, table_id, hand_id, raw (JSON), created_at

const HandHistory = sequelize.define(
  'HandHistory',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    table_id: { type: DataTypes.INTEGER, allowNull: true },
    hand_id: { type: DataTypes.STRING, allowNull: true },
    raw: { type: DataTypes.JSONB, allowNull: true }, // full raw event from game server
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: 'hand_history',
    timestamps: false,
    indexes: [{ fields: ['table_id'] }, { fields: ['hand_id'] }],
  }
);

module.exports = HandHistory;
