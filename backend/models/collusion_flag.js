const { DataTypes } = require('sequelize');
const sequelize = require('../db/sequelize');

// Converted from models/collusion_flag.py:
//
//   class CollusionFlag(Base):
//       __tablename__ = "collusion_flags"
//       id, user_ids (JSON list), table_id, hand_id, flag_type, severity (1-10), details (JSON), resolved, created_at

const CollusionFlag = sequelize.define(
  'CollusionFlag',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    user_ids: { type: DataTypes.JSONB, allowNull: true }, // list of involved players
    table_id: { type: DataTypes.INTEGER, allowNull: true },
    hand_id: { type: DataTypes.STRING, allowNull: true },
    flag_type: { type: DataTypes.STRING, allowNull: true }, // e.g. "soft_play", "chip_dump", "shared_cards"
    severity: { type: DataTypes.INTEGER, allowNull: true }, // 1-10
    details: { type: DataTypes.JSONB, allowNull: true },
    resolved: { type: DataTypes.BOOLEAN, defaultValue: false },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: 'collusion_flags',
    timestamps: false,
    indexes: [{ fields: ['table_id'] }, { fields: ['hand_id'] }],
  }
);

module.exports = CollusionFlag;
