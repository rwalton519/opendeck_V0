const { DataTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const sequelize = require('../db/sequelize');

// ADDED (spec recommendation §7.4 / §12): persistence for the real
// provably-fair deck engine (services/rng/deckService.js). Nothing like
// this table existed before - the /rng and /game routers returned
// hardcoded literals with no backing state at all. Column layout is
// deliberately close to the `games` table shape referenced by this
// project's own (otherwise-stale) original migration history, since that
// was clearly the intended schema even though it was never actually wired
// up to real logic.
const Game = sequelize.define(
  'Game',
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: () => uuidv4() },
    user_id: { type: DataTypes.INTEGER, allowNull: true },

    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    finished_at: { type: DataTypes.DATE, allowNull: true },

    // Secret until reveal. Never included in any pre-reveal API response -
    // see routers/rng.js and routers/game.js for the enforcement of that.
    seed: { type: DataTypes.STRING(64), allowNull: false },

    // sha256(seed), published immediately at commit time.
    deck_commit: { type: DataTypes.STRING(64), allowNull: false },

    // Full 52-card order derived from `seed`. Stored so /reveal doesn't
    // need to recompute it, but it is never returned by any endpoint
    // before finished_at is set.
    deck_original: { type: DataTypes.JSONB, allowNull: false },

    cut_index: { type: DataTypes.INTEGER, allowNull: true },
    deck_after_cut: { type: DataTypes.JSONB, allowNull: true },
    // sha256 commitment to deck_after_cut, published at cut time - lets a
    // verifier confirm post-reveal that the cut deck wasn't changed after
    // the fact, without leaking real card order before it's used.
    deck_after_cut_commit: { type: DataTypes.STRING(64), allowNull: true },

    revealed: { type: DataTypes.BOOLEAN, defaultValue: false },
    // Recomputed and stored every time GET /game/:id/verify is called, but
    // that endpoint always recomputes from scratch rather than trusting
    // this column - see routers/game.js.
    verified: { type: DataTypes.BOOLEAN, allowNull: true },
  },
  {
    tableName: 'games',
    timestamps: false,
  }
);

module.exports = Game;
