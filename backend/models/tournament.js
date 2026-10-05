const { DataTypes } = require('sequelize');
const sequelize = require('../db/sequelize');
const { TournamentSize, TournamentState, TournamentStake } = require('./enums');

// Converted from models/tournament.py's MODEST_BLIND_LEVELS
const MODEST_BLIND_LEVELS = [
  { small: 100, big: 200 },
  { small: 150, big: 300 },
  { small: 200, big: 400 },
  { small: 300, big: 600 },
  { small: 400, big: 800 },
  { small: 600, big: 1200 },
  { small: 800, big: 1600 },
  { small: 1000, big: 2000 },
  { small: 1500, big: 3000 },
  { small: 2000, big: 4000 },
  { small: 3000, big: 6000 },
  { small: 4000, big: 8000 },
  { small: 6000, big: 12000 },
  { small: 8000, big: 16000 },
  { small: 10000, big: 20000 },
];

const Tournament = sequelize.define(
  'Tournament',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false },

    size: { type: DataTypes.ENUM(...Object.values(TournamentSize)), allowNull: false },
    stake: { type: DataTypes.ENUM(...Object.values(TournamentStake)), allowNull: false },
    state: {
      type: DataTypes.ENUM(...Object.values(TournamentState)),
      defaultValue: TournamentState.WAITING,
    },

    max_players: { type: DataTypes.INTEGER, allowNull: false },
    max_players_per_table: { type: DataTypes.INTEGER, allowNull: false },

    buyin_total: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    buyin_prize_pool: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    buyin_house_fee: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    buyin_staff_tip: { type: DataTypes.DECIMAL(10, 2), allowNull: false },

    is_freeroll: { type: DataTypes.BOOLEAN, defaultValue: false },

    starting_stack: { type: DataTypes.INTEGER, allowNull: false },
    level_duration_minutes: { type: DataTypes.INTEGER, allowNull: false },
    late_registration_levels: { type: DataTypes.INTEGER, allowNull: false },
    rebuys_allowed: { type: DataTypes.BOOLEAN, defaultValue: true },
    rebuys_until_level: { type: DataTypes.INTEGER, allowNull: true },
    addons_allowed: { type: DataTypes.BOOLEAN, defaultValue: true },
    addons_break_number: { type: DataTypes.INTEGER, allowNull: true },
    payouts_top_percent: { type: DataTypes.INTEGER, defaultValue: 15 },

    current_level: { type: DataTypes.INTEGER, defaultValue: 1 },
    started_at: { type: DataTypes.DATE, allowNull: true },
    level_start_time: { type: DataTypes.DATE, allowNull: true },
    level_end_time: { type: DataTypes.DATE, allowNull: true },
    finished_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    tableName: 'tournaments',
    timestamps: false,
  }
);

const TournamentRegistration = sequelize.define(
  'TournamentRegistration',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tournament_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tournaments', key: 'id' } },
    user_id: { type: DataTypes.INTEGER, allowNull: false },

    stack: { type: DataTypes.INTEGER, allowNull: false },
    is_seated: { type: DataTypes.BOOLEAN, defaultValue: false },
    seat_number: { type: DataTypes.INTEGER, allowNull: true },
    table_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'tournament_tables', key: 'id' },
    },
    eliminated: { type: DataTypes.BOOLEAN, defaultValue: false },
    elimination_position: { type: DataTypes.INTEGER, allowNull: true },

    prize_pool_contribution: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
    payout_amount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
  },
  {
    tableName: 'tournament_registrations',
    timestamps: false,
  }
);

const TournamentTable = sequelize.define(
  'TournamentTable',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tournament_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tournaments', key: 'id' } },
    table_number: { type: DataTypes.INTEGER, allowNull: false },
  },
  {
    tableName: 'tournament_tables',
    timestamps: false,
  }
);

// relationships (SQLAlchemy relationship()/back_populates -> Sequelize associations)
Tournament.hasMany(TournamentRegistration, {
  as: 'registrations',
  foreignKey: 'tournament_id',
  onDelete: 'CASCADE',
  hooks: true,
});
TournamentRegistration.belongsTo(Tournament, { as: 'tournament', foreignKey: 'tournament_id' });

Tournament.hasMany(TournamentTable, {
  as: 'tables',
  foreignKey: 'tournament_id',
  onDelete: 'CASCADE',
  hooks: true,
});
TournamentTable.belongsTo(Tournament, { as: 'tournament', foreignKey: 'tournament_id' });

TournamentTable.hasMany(TournamentRegistration, { as: 'players', foreignKey: 'table_id' });
TournamentRegistration.belongsTo(TournamentTable, { as: 'table', foreignKey: 'table_id' });

/**
 * Converted from Tournament.to_dict(). Requires `registrations` and `tables`
 * to have been eager-loaded (e.g. via `{ include: ['registrations', 'tables'] }`)
 * before calling this, same as the Python version implicitly relies on
 * SQLAlchemy's lazy-loading of `self.registrations` / `self.tables`.
 */
function tournamentToDict(t) {
  const toFloat = (x) => (x === null || x === undefined ? null : parseFloat(x));

  const registrations = t.registrations || [];
  const tables = t.tables || [];

  let blinds = null;
  const idx = (t.current_level || 1) - 1;
  if (idx >= 0 && idx < MODEST_BLIND_LEVELS.length) {
    blinds = MODEST_BLIND_LEVELS[idx];
  }

  return {
    id: t.id,
    name: t.name,

    size: t.size,
    stake: t.stake,
    state: t.state,

    currentLevel: t.current_level,
    levelStartTime: t.level_start_time ? new Date(t.level_start_time).toISOString() : null,
    levelEndTime: t.level_end_time ? new Date(t.level_end_time).toISOString() : null,

    smallBlind: blinds ? blinds.small : null,
    bigBlind: blinds ? blinds.big : null,

    playersRemaining: registrations.filter((r) => !r.eliminated).length,
    totalPlayers: registrations.length,
    maxPlayers: t.max_players,

    buyinTotal: toFloat(t.buyin_total),
    buyinPrizePool: toFloat(t.buyin_prize_pool),
    buyinHouseFee: toFloat(t.buyin_house_fee),
    buyinStaffTip: toFloat(t.buyin_staff_tip),

    rebuysAllowed: t.rebuys_allowed,
    rebuysUntilLevel: t.rebuys_until_level,
    addonsAllowed: t.addons_allowed,
    addonsBreakNumber: t.addons_break_number,

    payoutsTopPercent: t.payouts_top_percent,

    tableCount: tables.length,
  };
}

// Attach as an instance method too, mirroring `t.to_dict()` call sites.
Tournament.prototype.toDict = function toDict() {
  return tournamentToDict(this);
};

module.exports = {
  Tournament,
  TournamentRegistration,
  TournamentTable,
  MODEST_BLIND_LEVELS,
  tournamentToDict,
};
