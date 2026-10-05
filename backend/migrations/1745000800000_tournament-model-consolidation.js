/* eslint-disable camelcase */

exports.shorthands = undefined;

// Tournament model consolidation - see MIGRATIONS.md for the full writeup.
//
// `game_tournaments` (created in 1745000200000_tournaments.js) backed a
// second, parallel tournament data model - services/game/models/tournamentModels.js's
// `GameTournament`, a single JSONB `players` blob, deliberately NOT
// FK-linked to `tournaments`. That file has been removed: every place that
// used to read/write GameTournament (services/game/tournamentManager.js,
// services/game/buyinManager.js, services/game/settlementManager.js) now
// operates on the single canonical `tournaments` / `tournament_registrations`
// tables instead, with per-player chip stacks living on
// `tournament_registrations.stack` (already existed, already the source of
// truth for the REST API and scheduler) rather than a JSONB dict.
//
// `game_tournaments` had no foreign keys pointing into it from any other
// table (it was deliberately standalone), so dropping it is safe and
// carries no orphaned-reference risk.
exports.up = (pgm) => {
  pgm.dropTable('game_tournaments');
};

exports.down = (pgm) => {
  // Recreates the table shape only - NOT the data. If this migration is
  // rolled back, any GameTournament rows that existed before the `up` ran
  // are gone; there is no shadow copy kept anywhere. Rolling back also
  // does NOT restore services/game/models/tournamentModels.js or the old
  // GameTournament-based application code - this only restores the table.
  pgm.createTable('game_tournaments', {
    id: 'id',
    name: { type: 'varchar(255)', notNull: true },
    buy_in: { type: 'numeric(18,2)', notNull: true },
    starting_stack: { type: 'integer', notNull: true },
    players: { type: 'jsonb', notNull: false, default: pgm.func("'{}'::jsonb") },
    prize_pool: { type: 'numeric(18,2)', notNull: false, default: 0 },
    levels: { type: 'jsonb', notNull: false, default: pgm.func("'[]'::jsonb") },
    current_level: { type: 'integer', notNull: false, default: 0 },
    is_running: { type: 'boolean', notNull: false, default: false },
    created_at: { type: 'timestamp', notNull: false },
  });
};
