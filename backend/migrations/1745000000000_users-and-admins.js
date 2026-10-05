/* eslint-disable camelcase */

exports.shorthands = undefined;

// FIXED (spec recommendation §4.3 / §12): this whole migration set replaces
// the original 1745000000000_initial-schema.js and
// 1745100000000_tournament-expansion.js, which were an as-is conversion of
// stale Alembic history that predates the application's current models -
// they created a `users` table with a UUID id and a `password_hash` column,
// while the live models/user.js has always used an integer auto-increment
// id and a `password` column (same story for `wallets`/`transactions`
// tables that don't correspond to any current model at all). Those
// migrations were never actually runnable against this codebase; schema has
// been coming from Sequelize's sync() instead (see db/syncModels.js).
//
// This migration set is a fresh schema history, hand-written to match every
// current model file exactly, column for column. It is meant to fully
// replace sync() as the schema-management strategy - see db/syncModels.js
// and README.md for how the two now interact.
exports.up = (pgm) => {
  // Mirrors models/user.js
  pgm.createTable('users', {
    id: 'id', // serial primary key, matches DataTypes.INTEGER autoIncrement
    email: { type: 'varchar(255)', notNull: true },
    username: { type: 'varchar(255)', notNull: true },
    password: { type: 'varchar(255)', notNull: true },
  });
  pgm.addConstraint('users', 'users_email_key', { unique: 'email' });
  pgm.addConstraint('users', 'users_username_key', { unique: 'username' });
  pgm.createIndex('users', 'email');
  pgm.createIndex('users', 'username');

  // Mirrors models/admin.js
  pgm.createExtension('pgcrypto', { ifNotExists: true }); // provides gen_random_uuid()
  pgm.createTable('admins', {
    id: { type: 'uuid', notNull: true, primaryKey: true, default: pgm.func('gen_random_uuid()') },
    username: { type: 'varchar(50)', notNull: true },
    password_hash: { type: 'varchar(255)', notNull: true },
  });
  pgm.addConstraint('admins', 'admins_username_key', { unique: 'username' });
  pgm.createIndex('admins', 'username');
};

exports.down = (pgm) => {
  pgm.dropTable('admins');
  pgm.dropTable('users');
  pgm.dropExtension('pgcrypto', { ifExists: true });
};
