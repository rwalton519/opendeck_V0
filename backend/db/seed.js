/**
 * Seeds a handful of demo rows into an otherwise-empty database - a few
 * users, wallet balances, a cash game table, and a tournament in each
 * lifecycle state. Meant for local development, demos, and CI, NOT for
 * production (see the guard below).
 *
 * Idempotent: safe to run more than once. Every insert is guarded by a
 * `findOrCreate`/existence check keyed on a fixed demo identifier, so
 * re-running this doesn't create duplicate rows or crash on a unique
 * constraint.
 *
 * Usage:
 *   npm run migrate:up   # schema must exist first - this does NOT run migrations
 *   npm run seed
 *
 * Or, via Docker Compose:
 *   docker compose --profile seed run --rm seed
 */

require('dotenv').config();

const sequelize = require('./sequelize');
const User = require('../models/user');
const { WalletBalance } = require('../models/real_money');
const { Tournament, TournamentRegistration } = require('../models/tournament');
const { TournamentSize, TournamentStake, TournamentState } = require('../models/enums');
const { CashGameTable } = require('../services/game/models/tableModels');
const { hashPassword } = require('../auth/hashing');

// Guard: refuse to run against anything that isn't obviously a local/dev
// database. This is a heuristic, not a guarantee - it only checks the
// configured host, so it won't catch e.g. a production DB that's reachable
// at "localhost" through an SSH tunnel. Treat this as a speed bump, not a
// safety net; know what DATABASE_URL points at before running this.
function assertNotObviouslyProduction() {
  const url = process.env.DATABASE_URL || '';
  const host = process.env.PGHOST || '';
  const looksLocal = /localhost|127\.0\.0\.1|postgres:5432|@postgres\//.test(url) || /localhost|127\.0\.0\.1|^postgres$/.test(host);

  if (!looksLocal && process.env.SEED_ALLOW_NONLOCAL !== 'true') {
    throw new Error(
      `[seed] DATABASE_URL/PGHOST doesn't look like a local database ` +
        `(got PGHOST="${host}"). Refusing to run - this script creates ` +
        `arbitrary demo data and is not meant for a real environment. ` +
        `Set SEED_ALLOW_NONLOCAL=true to override if you're sure.`
    );
  }
}

const DEMO_USERS = [
  { email: 'demo.alice@opendeck.local', username: 'demo_alice', password: 'DemoPass123!', balance: 500 },
  { email: 'demo.bob@opendeck.local', username: 'demo_bob', password: 'DemoPass123!', balance: 500 },
  { email: 'demo.carol@opendeck.local', username: 'demo_carol', password: 'DemoPass123!', balance: 250 },
  { email: 'demo.dave@opendeck.local', username: 'demo_dave', password: 'DemoPass123!', balance: 250 },
];

async function seedUsers() {
  const users = [];
  for (const u of DEMO_USERS) {
    // eslint-disable-next-line no-await-in-loop
    const [user] = await User.findOrCreate({
      where: { email: u.email },
      defaults: {
        email: u.email,
        username: u.username,
        password: hashPassword(u.password),
        is_frozen: false,
      },
    });

    // eslint-disable-next-line no-await-in-loop
    await WalletBalance.findOrCreate({
      where: { user_id: String(user.id) },
      defaults: { user_id: String(user.id), available: u.balance, locked: 0 },
    });

    users.push(user);
  }
  return users;
}

async function seedCashTable() {
  const [table] = await CashGameTable.findOrCreate({
    where: { name: 'Demo Table - $1/$2 NLH' },
    defaults: {
      name: 'Demo Table - $1/$2 NLH',
      small_blind: 1,
      big_blind: 2,
      max_players: 6,
      seats: {},
      rake_enabled: true,
    },
  });
  return table;
}

async function seedTournaments(users) {
  // One WAITING (open for registration), one RUNNING (mid-play), one
  // FINISHED (for a "past tournaments" list) - covers every state the
  // frontend needs to render something for.
  const [waiting] = await Tournament.findOrCreate({
    where: { name: 'Demo Freeroll - Waiting' },
    defaults: {
      name: 'Demo Freeroll - Waiting',
      size: TournamentSize.MICRO,
      stake: TournamentStake.NANO,
      state: TournamentState.WAITING,
      max_players: 18,
      max_players_per_table: 9,
      buyin_total: 0,
      buyin_prize_pool: 0,
      buyin_house_fee: 0,
      buyin_staff_tip: 0,
      is_freeroll: true,
      starting_stack: 20000,
      level_duration_minutes: 12,
      late_registration_levels: 8,
      current_level: 1,
    },
  });

  const [running] = await Tournament.findOrCreate({
    where: { name: 'Demo Micro Stakes - Running' },
    defaults: {
      name: 'Demo Micro Stakes - Running',
      size: TournamentSize.STANDARD,
      stake: TournamentStake.MICRO,
      state: TournamentState.RUNNING,
      max_players: 36,
      max_players_per_table: 9,
      buyin_total: 60,
      buyin_prize_pool: 45,
      buyin_house_fee: 10,
      buyin_staff_tip: 5,
      is_freeroll: false,
      starting_stack: 20000,
      level_duration_minutes: 12,
      late_registration_levels: 8,
      current_level: 3,
      started_at: new Date(),
      level_start_time: new Date(),
      level_end_time: new Date(Date.now() + 12 * 60 * 1000),
    },
  });

  // Register the first two demo users into the running tournament so
  // GET /tournaments/:id has non-empty `registrations` to eager-load.
  for (const user of users.slice(0, 2)) {
    // eslint-disable-next-line no-await-in-loop
    await TournamentRegistration.findOrCreate({
      where: { tournament_id: running.id, user_id: user.id },
      defaults: {
        tournament_id: running.id,
        user_id: user.id,
        stack: 18500,
        prize_pool_contribution: 45,
      },
    });
  }

  await Tournament.findOrCreate({
    where: { name: 'Demo Mid Stakes - Finished' },
    defaults: {
      name: 'Demo Mid Stakes - Finished',
      size: TournamentSize.MICRO,
      stake: TournamentStake.MID,
      state: TournamentState.FINISHED,
      max_players: 18,
      max_players_per_table: 9,
      buyin_total: 120,
      buyin_prize_pool: 90,
      buyin_house_fee: 20,
      buyin_staff_tip: 10,
      is_freeroll: false,
      starting_stack: 20000,
      level_duration_minutes: 12,
      late_registration_levels: 8,
      current_level: 9,
      started_at: new Date(Date.now() - 3 * 60 * 60 * 1000),
      finished_at: new Date(Date.now() - 60 * 60 * 1000),
    },
  });

  return { waiting, running };
}

async function main() {
  assertNotObviouslyProduction();

  await sequelize.authenticate();
  console.log('[seed] Connected to database.');

  const users = await seedUsers();
  console.log(`[seed] Users ready: ${users.map((u) => u.username).join(', ')}`);

  const table = await seedCashTable();
  console.log(`[seed] Cash game table ready: "${table.name}" (id ${table.id})`);

  const { waiting, running } = await seedTournaments(users);
  console.log(`[seed] Tournaments ready: "${waiting.name}" (id ${waiting.id}), "${running.name}" (id ${running.id})`);

  console.log('[seed] Done. Demo login: demo.alice@opendeck.local / DemoPass123!');
  await sequelize.close();
}

main().catch((err) => {
  console.error('[seed] Failed:', err);
  process.exitCode = 1;
});
