const { DataTypes } = require('sequelize');
const sequelize = require('../db/sequelize');
const { TournamentStake } = require('./enums');

// Converted from models/ticket.py:
//
//   class TournamentTicket(Base):
//       __tablename__ = "tournament_tickets"
//       id = Column(Integer, primary_key=True)
//       user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
//       stake = Column(Enum(TournamentStake), nullable=False)
//       created_at = Column(DateTime, default=datetime.utcnow)
//       used = Column(Boolean, default=False)

const TournamentTicket = sequelize.define(
  'TournamentTicket',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
    stake: { type: DataTypes.ENUM(...Object.values(TournamentStake)), allowNull: false },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    used: { type: DataTypes.BOOLEAN, defaultValue: false },
  },
  {
    tableName: 'tournament_tickets',
    timestamps: false,
  }
);

module.exports = TournamentTicket;
