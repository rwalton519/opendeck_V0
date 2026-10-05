const { DataTypes } = require('sequelize');
const sequelize = require('../../../db/sequelize');

// Converted from services/game/models/hand_models.py:
//
//   class PokerHand(Base):
//       __tablename__ = "poker_hands"
//       id, table_id, pots (JSON list), results (JSON dict), rake (Numeric), created_at

const PokerHand = sequelize.define(
  'PokerHand',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    table_id: { type: DataTypes.INTEGER, allowNull: false },
    pots: { type: DataTypes.JSONB, defaultValue: [] }, // [{ amount, eligible_players: [...] }]
    results: { type: DataTypes.JSONB, defaultValue: {} }, // { player_id: chips_won }
    rake: { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: 'poker_hands',
    timestamps: false,
  }
);

module.exports = { PokerHand };
