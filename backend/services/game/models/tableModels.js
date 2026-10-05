const { DataTypes } = require('sequelize');
const sequelize = require('../../../db/sequelize');

// Converted from services/game/models/table_models.py:
//
//   class CashGameTable(Base):
//       __tablename__ = "cash_game_tables"
//       id, name, small_blind, big_blind, max_players, seats (JSON dict),
//       rake_enabled, last_rake_time, created_at

const CashGameTable = sequelize.define(
  'CashGameTable',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false },
    small_blind: { type: DataTypes.INTEGER, allowNull: false },
    big_blind: { type: DataTypes.INTEGER, allowNull: false },
    max_players: { type: DataTypes.INTEGER, defaultValue: 9 },

    // seat -> chip balance
    seats: { type: DataTypes.JSONB, defaultValue: {} },

    // rake timer (time-based rake)
    rake_enabled: { type: DataTypes.BOOLEAN, defaultValue: true },
    last_rake_time: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },

    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: 'cash_game_tables',
    timestamps: false,
  }
);

module.exports = { CashGameTable };
