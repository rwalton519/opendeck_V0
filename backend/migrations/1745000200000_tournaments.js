/* eslint-disable camelcase */

exports.shorthands = undefined;

// Mirrors models/tournament.js, models/ticket.js, and
// services/game/models/tournamentModels.js. Note: `tournaments` (typed,
// relational) and `game_tournaments` (single JSONB `players` blob) are two
// genuinely separate, parallel data models in this codebase - not a
// duplicate to merge - see the cross-chunk name-collision note preserved in
// services/game/models/tournamentModels.js.
exports.up = (pgm) => {
  pgm.createType('tournamentsize', ['MICRO', 'STANDARD', 'LARGE']);
  pgm.createType('tournamentstake', ['NANO', 'MICRO', 'MID', 'MACRO']);
  pgm.createType('tournamentstate', ['WAITING', 'RUNNING', 'BREAK', 'FINISHED']);

  pgm.createTable('tournaments', {
    id: 'id',
    name: { type: 'varchar(255)', notNull: true },

    size: { type: 'tournamentsize', notNull: true },
    stake: { type: 'tournamentstake', notNull: true },
    state: { type: 'tournamentstate', notNull: false, default: 'WAITING' },

    max_players: { type: 'integer', notNull: true },
    max_players_per_table: { type: 'integer', notNull: true },

    buyin_total: { type: 'numeric(10,2)', notNull: true },
    buyin_prize_pool: { type: 'numeric(10,2)', notNull: true },
    buyin_house_fee: { type: 'numeric(10,2)', notNull: true },
    buyin_staff_tip: { type: 'numeric(10,2)', notNull: true },

    is_freeroll: { type: 'boolean', notNull: false, default: false },

    starting_stack: { type: 'integer', notNull: true },
    level_duration_minutes: { type: 'integer', notNull: true },
    late_registration_levels: { type: 'integer', notNull: true },
    rebuys_allowed: { type: 'boolean', notNull: false, default: true },
    rebuys_until_level: { type: 'integer', notNull: false },
    addons_allowed: { type: 'boolean', notNull: false, default: true },
    addons_break_number: { type: 'integer', notNull: false },
    payouts_top_percent: { type: 'integer', notNull: false, default: 15 },

    current_level: { type: 'integer', notNull: false, default: 1 },
    started_at: { type: 'timestamp', notNull: false },
    level_start_time: { type: 'timestamp', notNull: false },
    level_end_time: { type: 'timestamp', notNull: false },
    finished_at: { type: 'timestamp', notNull: false },
  });

  pgm.createTable('tournament_tables', {
    id: 'id',
    tournament_id: { type: 'integer', notNull: true, references: '"tournaments"', onDelete: 'CASCADE' },
    table_number: { type: 'integer', notNull: true },
  });
  pgm.createIndex('tournament_tables', 'tournament_id');

  pgm.createTable('tournament_registrations', {
    id: 'id',
    tournament_id: { type: 'integer', notNull: true, references: '"tournaments"', onDelete: 'CASCADE' },
    user_id: { type: 'integer', notNull: true },

    stack: { type: 'integer', notNull: true },
    is_seated: { type: 'boolean', notNull: false, default: false },
    seat_number: { type: 'integer', notNull: false },
    table_id: { type: 'integer', notNull: false, references: '"tournament_tables"', onDelete: 'SET NULL' },
    eliminated: { type: 'boolean', notNull: false, default: false },
    elimination_position: { type: 'integer', notNull: false },

    prize_pool_contribution: { type: 'numeric(10,2)', notNull: false, default: 0 },
    payout_amount: { type: 'numeric(10,2)', notNull: false },
  });
  pgm.createIndex('tournament_registrations', 'tournament_id');
  pgm.createIndex('tournament_registrations', 'user_id');
  pgm.createIndex('tournament_registrations', 'table_id');

  pgm.createTable('tournament_tickets', {
    id: 'id',
    user_id: { type: 'integer', notNull: true, references: '"users"', onDelete: 'CASCADE' },
    stake: { type: 'tournamentstake', notNull: true },
    created_at: { type: 'timestamp', notNull: false },
    used: { type: 'boolean', notNull: false, default: false },
  });
  pgm.createIndex('tournament_tickets', 'user_id');

  // Mirrors services/game/models/tournamentModels.js (GameTournament) -
  // deliberately not FK-linked to `tournaments`; these are separate models.
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

exports.down = (pgm) => {
  pgm.dropTable('game_tournaments');
  pgm.dropTable('tournament_tickets');
  pgm.dropTable('tournament_registrations');
  pgm.dropTable('tournament_tables');
  pgm.dropTable('tournaments');
  pgm.dropType('tournamentstate');
  pgm.dropType('tournamentstake');
  pgm.dropType('tournamentsize');
};
