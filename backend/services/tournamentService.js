// NOTE: app.models.tournament.{Tournament, TournamentRegistration,
// TournamentTable} - see the sibling chunk's models/tournament.js.
const { Tournament, TournamentRegistration, TournamentTable } = require('../models/tournament');
// NOTE: app.models.enums.{TournamentSize, TournamentState, TournamentStake} -
// see the sibling chunk's models/enums.js.
const { TournamentSize, TournamentState, TournamentStake } = require('../models/enums');

// ---------------------------------------------------------
// BLIND LEVEL SCHEDULE (modest, constant, smooth progression)
// ---------------------------------------------------------
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

// ---------------------------------------------------------
// BUY-IN STRUCTURE (stake -> breakdown)
// ---------------------------------------------------------
const STAKE_BUYINS = {
  [TournamentStake.NANO]: { total: 12, prize_pool: 9, house_fee: 2, staff_tip: 1 },
  [TournamentStake.MICRO]: { total: 60, prize_pool: 45, house_fee: 10, staff_tip: 5 },
  [TournamentStake.MID]: { total: 120, prize_pool: 90, house_fee: 20, staff_tip: 10 },
  [TournamentStake.MACRO]: { total: 600, prize_pool: 450, house_fee: 100, staff_tip: 50 },
};

// ---------------------------------------------------------
// MAX PLAYERS PER TOURNAMENT SIZE
// ---------------------------------------------------------
const SIZE_TO_MAX_PLAYERS = {
  [TournamentSize.MICRO]: 18,
  [TournamentSize.STANDARD]: 36,
  [TournamentSize.LARGE]: 72,
};

// ---------------------------------------------------------
// CREATE TOURNAMENT
// ---------------------------------------------------------
async function createTournament(db, data) {
  const maxPlayers = SIZE_TO_MAX_PLAYERS[data.size];
  const buyin = STAKE_BUYINS[data.stake];

  const t = await Tournament.create({
    name: data.name,
    size: data.size,
    stake: data.stake,
    max_players: maxPlayers,
    max_players_per_table: 9,

    // BUY-IN BREAKDOWN
    buyin_total: buyin.total,
    buyin_prize_pool: buyin.prize_pool,
    buyin_house_fee: buyin.house_fee,
    buyin_staff_tip: buyin.staff_tip,

    is_freeroll: !!data.is_freeroll,
    starting_stack: 20000,
    level_duration_minutes: 12,
    late_registration_levels: 8,
    rebuys_allowed: true,
    rebuys_until_level: 8,
    addons_allowed: true,
    addons_break_number: 1,
    payouts_top_percent: 15,
    state: TournamentState.WAITING,
    current_level: 1,
  });

  return t;
}

// ---------------------------------------------------------
// REGISTER PLAYER (with buy-in enforcement)
// ---------------------------------------------------------
async function registerPlayer(db, tournamentId, userId) {
  const t = await Tournament.findOne({ where: { id: tournamentId } });
  if (!t) {
    throw new Error('Tournament not found');
  }

  if (t.state !== TournamentState.WAITING) {
    throw new Error('Registration closed');
  }

  // enforce max players
  const currentRegCount = await TournamentRegistration.count({
    where: { tournament_id: tournamentId },
  });
  if (currentRegCount >= t.max_players) {
    throw new Error('Tournament full');
  }

  // BUY-IN ENFORCEMENT
  const buyin = STAKE_BUYINS[t.stake];
  const prizePoolPart = buyin.prize_pool;

  // TODO: deduct from user wallet
  // wallet_service.debit(user_id, buyin.total)

  // TODO: record revenue
  // revenue_service.record(buyin.house_fee, buyin.staff_tip)

  const reg = await TournamentRegistration.create({
    tournament_id: tournamentId,
    user_id: userId,
    stack: t.starting_stack,
    prize_pool_contribution: prizePoolPart,
  });

  return reg;
}

// ---------------------------------------------------------
// REBUY LOGIC
// ---------------------------------------------------------
async function rebuyPlayer(db, tournamentId, userId) {
  const t = await Tournament.findOne({ where: { id: tournamentId } });
  if (!t) {
    throw new Error('Tournament not found');
  }

  if (!t.rebuys_allowed) {
    throw new Error('Rebuys not allowed');
  }

  if (t.current_level > (t.rebuys_until_level || 0)) {
    throw new Error('Rebuy period over');
  }

  const reg = await TournamentRegistration.findOne({
    where: { tournament_id: tournamentId, user_id: userId },
  });
  if (!reg) {
    throw new Error('Player not registered');
  }

  // TODO: wallet debit for another buy-in
  // wallet_service.debit(user_id, STAKE_BUYINS[t.stake].total)

  reg.stack += t.starting_stack;
  reg.eliminated = false;
  reg.elimination_position = null;

  await reg.save();
  return reg;
}

// ---------------------------------------------------------
// ADDON LOGIC
// ---------------------------------------------------------
async function addonPlayer(db, tournamentId, userId) {
  const t = await Tournament.findOne({ where: { id: tournamentId } });
  if (!t) {
    throw new Error('Tournament not found');
  }

  if (!t.addons_allowed) {
    throw new Error('Addons not allowed');
  }

  const reg = await TournamentRegistration.findOne({
    where: { tournament_id: tournamentId, user_id: userId },
  });
  if (!reg) {
    throw new Error('Player not registered');
  }

  // TODO: wallet debit for addon
  // wallet_service.debit(user_id, STAKE_BUYINS[t.stake].total)

  // For now, addon = one more starting stack
  reg.stack += t.starting_stack;

  await reg.save();
  return reg;
}

// ---------------------------------------------------------
// START TOURNAMENT
// ---------------------------------------------------------
async function _startTournament(t, now) {
  t.state = TournamentState.RUNNING;
  t.started_at = now;
  t.current_level = 1;
  t.level_start_time = now;
  t.level_end_time = new Date(now.getTime() + t.level_duration_minutes * 60 * 1000);

  await _createTablesAndSeatPlayers(t);
  await t.save();
}

// ---------------------------------------------------------
// CREATE TABLES + SEAT PLAYERS (deterministic)
// ---------------------------------------------------------
async function _createTablesAndSeatPlayers(t) {
  const regs = [...(t.registrations || [])].sort((a, b) => a.id - b.id);

  const maxPerTable = t.max_players_per_table;
  const totalPlayers = regs.length;
  if (totalPlayers === 0) return;

  const numTables = Math.ceil(totalPlayers / maxPerTable);

  const tables = [];
  for (let i = 1; i <= numTables; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const tbl = await TournamentTable.create({ tournament_id: t.id, table_number: i });
    tables.push(tbl);
  }

  let tableIndex = 0;
  const tableSeatMap = new Map(tables.map((tbl) => [tbl.id, 1]));

  for (const reg of regs) {
    const tbl = tables[tableIndex];
    reg.table_id = tbl.id;
    reg.is_seated = true;
    reg.seat_number = tableSeatMap.get(tbl.id);
    tableSeatMap.set(tbl.id, tableSeatMap.get(tbl.id) + 1);

    // eslint-disable-next-line no-await-in-loop
    await reg.save();

    tableIndex = (tableIndex + 1) % tables.length;
  }
}

// ---------------------------------------------------------
// TABLE BALANCING (deterministic)
// ---------------------------------------------------------
async function balanceTables(t) {
  const tables = t.tables || [];
  if (tables.length === 0) return;

  const tablePlayers = tables.map((tbl) => [tbl, (tbl.players || []).filter((p) => !p.eliminated)]);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    tablePlayers.sort((a, b) => a[1].length - b[1].length);
    const [shortestTbl, shortestPlayers] = tablePlayers[0];
    const [, fullestPlayers] = tablePlayers[tablePlayers.length - 1];

    if (fullestPlayers.length - shortestPlayers.length <= 1) {
      break;
    }

    const playerToMove = [...fullestPlayers].sort(
      (a, b) => (b.seat_number || 0) - (a.seat_number || 0)
    )[0];

    fullestPlayers.splice(fullestPlayers.indexOf(playerToMove), 1);

    const existingSeats = shortestPlayers.map((p) => p.seat_number).filter(Boolean);
    let nextSeat = 1;
    while (existingSeats.includes(nextSeat)) {
      nextSeat += 1;
    }

    playerToMove.table_id = shortestTbl.id;
    playerToMove.seat_number = nextSeat;
    // eslint-disable-next-line no-await-in-loop
    await playerToMove.save();

    shortestPlayers.push(playerToMove);
  }
}

// ---------------------------------------------------------
// ELIMINATION LOGIC
// ---------------------------------------------------------
async function eliminatePlayer(db, reg, t) {
  reg.eliminated = true;

  const remaining = await TournamentRegistration.count({
    where: { tournament_id: t.id, eliminated: false },
  });

  reg.elimination_position = remaining + 1;
  await reg.save();
}

// ---------------------------------------------------------
// PAYOUT CALCULATION
// ---------------------------------------------------------
async function calculatePayouts(t, db) {
  const regs = t.registrations || [];
  const totalPlayers = regs.length;

  const payoutCount = Math.ceil(totalPlayers * (t.payouts_top_percent / 100));
  const prizePool = regs.reduce((sum, r) => sum + parseFloat(r.prize_pool_contribution), 0);

  let distribution;
  if (payoutCount === 1) {
    distribution = [1.0];
  } else {
    distribution = [0.25, 0.17, 0.12];
    const remaining = payoutCount - 3;
    if (remaining > 0) {
      const evenSplit = (1.0 - distribution.reduce((a, b) => a + b, 0)) / remaining;
      distribution = distribution.concat(new Array(remaining).fill(evenSplit));
    }
  }

  const { Op } = require('sequelize'); // eslint-disable-line global-require
  const paidPlayers = await TournamentRegistration.findAll({
    where: { tournament_id: t.id, elimination_position: { [Op.lte]: payoutCount } },
    order: [['elimination_position', 'ASC']],
  });

  for (let idx = 0; idx < paidPlayers.length; idx += 1) {
    const pct = distribution[idx];
    const player = paidPlayers[idx];
    player.payout_amount = Math.round(prizePool * pct * 100) / 100;
    // eslint-disable-next-line no-await-in-loop
    await player.save();
  }
}

module.exports = {
  MODEST_BLIND_LEVELS,
  STAKE_BUYINS,
  SIZE_TO_MAX_PLAYERS,
  createTournament,
  registerPlayer,
  rebuyPlayer,
  addonPlayer,
  _startTournament,
  _createTablesAndSeatPlayers,
  balanceTables,
  eliminatePlayer,
  calculatePayouts,
};
