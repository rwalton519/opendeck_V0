/* eslint-disable camelcase */

exports.shorthands = undefined;

// Mirrors services/game/models/tableModels.js, services/game/models/handModels.js,
// and models/hand_history.js.
exports.up = (pgm) => {
  pgm.createTable('cash_game_tables', {
    id: 'id',
    name: { type: 'varchar(255)', notNull: true },
    small_blind: { type: 'integer', notNull: true },
    big_blind: { type: 'integer', notNull: true },
    max_players: { type: 'integer', notNull: false, default: 9 },
    seats: { type: 'jsonb', notNull: false, default: pgm.func("'{}'::jsonb") }, // seat -> chip balance
    rake_enabled: { type: 'boolean', notNull: false, default: true },
    last_rake_time: { type: 'timestamp', notNull: false },
    created_at: { type: 'timestamp', notNull: false },
  });

  pgm.createTable('poker_hands', {
    id: 'id',
    table_id: { type: 'integer', notNull: true },
    pots: { type: 'jsonb', notNull: false, default: pgm.func("'[]'::jsonb") },
    results: { type: 'jsonb', notNull: false, default: pgm.func("'{}'::jsonb") },
    rake: { type: 'numeric(18,2)', notNull: false, default: 0 },
    created_at: { type: 'timestamp', notNull: false },
  });
  pgm.createIndex('poker_hands', 'table_id');

  pgm.createTable('hand_history', {
    id: 'id',
    table_id: { type: 'integer', notNull: false },
    hand_id: { type: 'varchar(255)', notNull: false },
    raw: { type: 'jsonb', notNull: false },
    created_at: { type: 'timestamp', notNull: false },
  });
  pgm.createIndex('hand_history', 'table_id');
  pgm.createIndex('hand_history', 'hand_id');
};

exports.down = (pgm) => {
  pgm.dropTable('hand_history');
  pgm.dropTable('poker_hands');
  pgm.dropTable('cash_game_tables');
};
