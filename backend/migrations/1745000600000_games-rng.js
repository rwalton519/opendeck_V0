/* eslint-disable camelcase */

exports.shorthands = undefined;

// ADDED as part of the fix for §7.4 (provably-fair RNG was previously a
// hardcoded mock with no backing state at all). Mirrors models/game.js.
exports.up = (pgm) => {
  pgm.createExtension('pgcrypto', { ifNotExists: true }); // provides gen_random_uuid(), shared with admins table

  pgm.createTable('games', {
    id: { type: 'uuid', notNull: true, primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'integer', notNull: false },

    created_at: { type: 'timestamp', notNull: false },
    finished_at: { type: 'timestamp', notNull: false },

    seed: { type: 'varchar(64)', notNull: true },
    deck_commit: { type: 'varchar(64)', notNull: true },
    deck_original: { type: 'jsonb', notNull: true },

    cut_index: { type: 'integer', notNull: false },
    deck_after_cut: { type: 'jsonb', notNull: false },
    deck_after_cut_commit: { type: 'varchar(64)', notNull: false },

    revealed: { type: 'boolean', notNull: false, default: false },
    verified: { type: 'boolean', notNull: false },
  });

  pgm.createIndex('games', 'user_id');
};

exports.down = (pgm) => {
  pgm.dropTable('games');
};
