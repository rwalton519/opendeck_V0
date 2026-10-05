const express = require('express');
const router = express.Router();

// NOTE: this file REPLACES three previously-delivered, mutually-inconsistent
// router files: chunk1's api/routes/tournamentRouter.js (prefix "/tournament",
// all-POST, no list/detail routes), chunk2's routers/tournament.js (also
// "/tournament", query-param user_id), and chunk2's
// routers/tournament_router.js (prefix "/api/tournaments", closest match
// but still wrong prefix and a different ticket-lookup path). Built directly
// against frontend_new/src/api/tournaments.ts's actual contract.

const { Tournament, tournamentToDict } = require('../models/tournament');
const TournamentTicket = require('../models/ticket');

const {
  createTournament,
  registerPlayer,
  rebuyPlayer,
  addonPlayer,
} = require('../services/tournamentService');

const { HttpError } = require('../utils/errors');

/**
 * frontend's normalizeTournament() checks snake_case keys FIRST in every
 * `raw.x ?? raw.y` fallback chain, and specifically needs a top-level
 * `small_blind`/`big_blind` (its `current_blinds.small` nested-object path
 * is checked first but nothing in this backend ever populates that shape,
 * so the snake_case flat fields are what actually get used) and
 * `max_players_per_table`, which tournamentToDict() (models/tournament.js)
 * doesn't expose at all. This wraps tournamentToDict()'s camelCase output
 * into the exact snake_case shape the frontend reads, rather than relying
 * on partial camelCase fallback matches.
 */
function toFrontendTournament(t) {
  const d = tournamentToDict(t);
  return {
    id: d.id,
    name: d.name,
    size: d.size,
    stake: d.stake,
    state: d.state,
    current_level: d.currentLevel,
    max_players: d.maxPlayers,
    max_players_per_table: t.max_players_per_table,
    buyin_total: d.buyinTotal,
    buyin_prize_pool: d.buyinPrizePool,
    buyin_house_fee: d.buyinHouseFee,
    buyin_staff_tip: d.buyinStaffTip,
    level_start_time: d.levelStartTime,
    level_end_time: d.levelEndTime,
    players_remaining: d.playersRemaining,
    total_players: d.totalPlayers,
    small_blind: d.smallBlind,
    big_blind: d.bigBlind,
  };
}

function toFrontendTicket(t) {
  return {
    id: t.id,
    tournament_id: null, // TournamentTicket has no tournament_id column (see models/ticket.js) - stake-based tickets aren't tied to one specific tournament
    stake: t.stake,
    created_at: t.created_at ? new Date(t.created_at).toISOString() : null,
  };
}

function parseUserId(raw) {
  const userId = parseInt(raw, 10);
  if (Number.isNaN(userId)) {
    throw new HttpError(400, 'user_id must be a valid integer (matches users.id)');
  }
  return userId;
}

// ---------------------------------------------------------------
// GET /tournaments -> Tournament[]
// ---------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const tournaments = await Tournament.findAll({ include: ['registrations', 'tables'] });
    res.json(tournaments.map(toFrontendTournament));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /tournaments (bonus - not called by the current frontend, kept for
// admin/testing convenience since the logic already existed)
// ---------------------------------------------------------------
router.post('/', async (req, res, next) => {
  try {
    const t = await createTournament(req.db, req.body);
    res.json(toFrontendTournament(t));
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// ---------------------------------------------------------------
// GET /tournaments/user/:userId/tickets -> Ticket[]
// ---------------------------------------------------------------
// IMPORTANT: registered BEFORE "/:tournamentId" below - "user" would
// otherwise be captured by that route first (Express matches by
// declaration order, same class of bug already flagged and fixed in
// chunk2's routers/tournament_router.js for its own "/my_tickets" route).
router.get('/user/:userId/tickets', async (req, res, next) => {
  try {
    const userId = parseUserId(req.params.userId);
    const tickets = await TournamentTicket.findAll({
      where: { user_id: userId },
      order: [['created_at', 'DESC']],
    });
    res.json(tickets.map(toFrontendTicket));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /tournaments/:id -> Tournament
// ---------------------------------------------------------------
router.get('/:id', async (req, res, next) => {
  try {
    const t = await Tournament.findByPk(req.params.id, { include: ['registrations', 'tables'] });
    if (!t) {
      throw new HttpError(404, 'Tournament not found');
    }
    res.json(toFrontendTournament(t));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /tournaments/:id/table_state
// ---------------------------------------------------------------
// Not normalized on the frontend (consumed as a raw Record<string, unknown>
// by TournamentTablePage), so this reuses the existing shape from chunk2's
// tournament_router.js unchanged.
router.get('/:id/table_state', async (req, res, next) => {
  try {
    const t = await Tournament.findByPk(req.params.id, {
      include: [{ association: 'tables', include: [{ association: 'players' }] }],
    });
    if (!t) {
      throw new HttpError(404, 'Tournament not found');
    }

    const tablesPayload = (t.tables || []).map((tbl) => ({
      id: tbl.id,
      table_number: tbl.table_number,
      players: (tbl.players || []).map((p) => ({
        registration_id: p.id,
        user_id: p.user_id,
        seat_number: p.seat_number,
        stack: parseInt(p.stack, 10),
        eliminated: p.eliminated,
      })),
    }));

    res.json({ tournament_id: t.id, tables: tablesPayload });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /tournaments/:id/register { user_id }
// ---------------------------------------------------------------
router.post('/:id/register', async (req, res, next) => {
  try {
    const tournamentId = parseInt(req.params.id, 10);
    const userId = parseUserId(req.body.user_id);

    const reg = await registerPlayer(req.db, tournamentId, userId);
    res.json({ status: 'ok', registration_id: reg.id });
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// ---------------------------------------------------------------
// POST /tournaments/:id/rebuy { user_id }
// ---------------------------------------------------------------
router.post('/:id/rebuy', async (req, res, next) => {
  try {
    const tournamentId = parseInt(req.params.id, 10);
    const userId = parseUserId(req.body.user_id);

    const reg = await rebuyPlayer(req.db, tournamentId, userId);
    res.json({ status: 'ok', registration_id: reg.id, stack: reg.stack });
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// ---------------------------------------------------------------
// POST /tournaments/:id/addon { user_id }
// ---------------------------------------------------------------
router.post('/:id/addon', async (req, res, next) => {
  try {
    const tournamentId = parseInt(req.params.id, 10);
    const userId = parseUserId(req.body.user_id);

    // tournamentService.addonPlayer's real signature only takes
    // (db, tournamentId, userId) - it doesn't take chip/cost params (unlike
    // services/game/tournamentManager.js's DIFFERENT addon() method, which
    // does). Calling the right one here.
    const reg = await addonPlayer(req.db, tournamentId, userId);
    res.json({ status: 'ok', registration_id: reg.id, stack: reg.stack });
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

module.exports = router;
