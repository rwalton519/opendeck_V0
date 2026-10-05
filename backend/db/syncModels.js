const path = require('node:path');
const fs = require('node:fs');
const sequelize = require('./sequelize');

// -----------------------------------------------------------------
// FIXED (spec recommendation §4.3 / §12): this module previously used
// Sequelize's sync({ alter }) as the ONLY schema-management strategy,
// because the migrations/ directory that shipped with this codebase was
// stale Alembic-converted history that didn't match any current model
// (wrong `users` schema, tables like `wallets`/`transactions` that don't
// exist as Sequelize models at all). sync() is fine for a laptop with a
// throwaway database; it is not an acceptable strategy for a database
// holding real user funds, since sync({ alter: true }) is not guaranteed
// safe against destructive changes (column drops/renames) and gives no
// reviewable, revertible history of what changed and when.
//
// A full, hand-written node-pg-migrate migration set now exists under
// migrations/, matching every current model file column-for-column (see
// each migration's header comment for exactly which model it mirrors).
// That is now the source of truth for schema changes. Run it with:
//
//   npm run migrate:up
//
// before starting the server for the first time (and after pulling any
// change that touches a model file). This module's job has narrowed to:
//   1. registering every model against the shared `sequelize` instance
//      (unchanged from before - still required so associations, JSONB
//      column definitions, etc. are known at runtime), and
//   2. verifying the app can actually reach the database and that its
//      required tables exist, WITHOUT attempting to alter the schema
//      by default.
//
// Falling back to sync() is still available, but now requires an explicit
// opt-in (DB_SYNC_ALTER=true) and is intended for local development only -
// e.g. spinning up a brand-new empty database quickly without running
// migrations by hand. It is deliberately NOT the default.
// -----------------------------------------------------------------

// FIXED (production incident, Aug 2026): the boot check below used to only
// verify that `pgmigrations` and `users` existed, not that every migration
// file in migrations/ actually had a corresponding row in it. That let
// migrations/1745000900000_demo-hand-history.js ship in the codebase and
// get deployed WITHOUT ever being run against the production database -
// the server booted, logged "Schema check passed", and then silently
// dropped every demo hand history write for as long as it ran, because
// nothing compared "migration files on disk" against "migrations actually
// applied". For a platform whose entire pitch is provably-fair,
// backtestable hand history, a missing table failing loud and blocking
// boot is far preferable to it failing quiet and dropping data. This now
// diffs the two lists and refuses to start if anything is missing.

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function migrationNamesOnDisk() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.js'))
    .map((f) => f.slice(0, -3)) // strip .js - matches node-pg-migrate's own
    // Migration.name derivation (path.basename(file, '.js')), so this list
    // is directly comparable to the `name` column in `pgmigrations`.
    .sort();
}

require('../models/index');
require('../services/game/models/handModels');
require('../services/game/models/tableModels');
// NOTE: services/game/models/tournamentModels.js (GameTournament) was
// removed as part of the tournament model consolidation - see
// MIGRATIONS.md. models/index.js already registers the single canonical
// Tournament/TournamentRegistration/TournamentTable models above.

async function syncModels() {
  const autoSync = process.env.DB_SYNC_ALTER === 'true';

  if (autoSync) {
    console.warn(
      '[db] DB_SYNC_ALTER=true - using Sequelize sync({ alter: true }) instead of ' +
        'migrations/. This is a development convenience only; do not run this ' +
        'against a database holding real user data. Run `npm run migrate:up` instead ' +
        'for any environment that matters.'
    );
    await sequelize.sync({ alter: true });
    console.log('[db] Sequelize sync complete (alter=true).');
    return;
  }

  // Default path: don't touch the schema. Just confirm we can connect and
  // that every migration on disk has actually been applied, so a
  // misconfigured or incompletely-deployed database fails loudly at boot
  // instead of on the first request (or, worse, not at all - see the
  // demo_hand_history incident referenced above, which failed silently on
  // every write instead of failing here).
  await sequelize.authenticate();

  const [rows] = await sequelize.query(
    "SELECT to_regclass('public.users') AS users_table, to_regclass('public.pgmigrations') AS migrations_table;"
  );
  const { users_table: usersTable, migrations_table: migrationsTable } = rows[0] || {};

  if (!migrationsTable) {
    throw new Error(
      "[db] No 'pgmigrations' tracking table found. Run `npm run migrate:up` before " +
        'starting the server (or set DB_SYNC_ALTER=true for local development).'
    );
  }

  if (!usersTable) {
    throw new Error(
      "[db] Required table 'users' does not exist. Run `npm run migrate:up` before " +
        'starting the server (or set DB_SYNC_ALTER=true for local development).'
    );
  }

  const onDisk = migrationNamesOnDisk();
  const [appliedRows] = await sequelize.query('SELECT name FROM pgmigrations ORDER BY name;');
  const applied = new Set(appliedRows.map((r) => r.name));
  const pending = onDisk.filter((name) => !applied.has(name));

  if (pending.length > 0) {
    throw new Error(
      `[db] ${pending.length} migration(s) on disk have not been applied to this database: ` +
        `${pending.join(', ')}. Run \`npm run migrate:up\` before starting the server ` +
        '(or set DB_SYNC_ALTER=true for local development). Refusing to boot rather than ' +
        'run with a schema that does not match the code - see git history on this check ' +
        'for why (a table missing at boot must fail loud, not drop writes silently).'
    );
  }

  console.log(
    `[db] Connected. Schema check passed - all ${onDisk.length} migration(s) on disk are applied.`
  );
}

module.exports = { syncModels };
