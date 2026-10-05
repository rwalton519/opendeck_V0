const express = require('express');
const router = express.Router();

const CashGameManager = require('../../services/game/cashgameManager');
const LiveHandEngine = require('../../services/game/liveHandEngine');

const {
  requireString,
  requireInt,
  optionalIntWithDefault,
  requireFloat,
  requireList,
  requireDict,
} = require('../../utils/validation');
const { HttpError } = require('../../utils/errors');
const { requireUser, optionalUser } = require('../../auth/requireUser');

// POST /cashgame/create
router.post('/create', async (req, res, next) => {
  try {
    const name = requireString(req.body, 'name');
    const smallBlind = requireInt(req.body, 'small_blind');
    const bigBlind = requireInt(req.body, 'big_blind');
    const maxPlayers = optionalIntWithDefault(req.body, 'max_players', 9);

    const result = await CashGameManager.createTable(req.db, name, smallBlind, bigBlind, maxPlayers);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// GET /cashgame/:tableId/state?user_id=... - full snapshot: seats + whatever
// hand is in progress (see liveHandEngine.js). `user_id`, if present, is
// whose own hole cards to reveal (never anyone else's, pre-showdown).
router.get('/:tableId/state', optionalUser, async (req, res, next) => {
  try {
    const tableId = await CashGameManager.resolveTableId(req.db, req.params.tableId);
    const viewerUserId = req.user ? String(req.user.id) : undefined;
    const state = await CashGameManager.getState(req.db, tableId, viewerUserId);
    res.json(state);
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// GET /cashgame/:tableId/stream - SSE, same pattern as
// /cashgame-demo/stream. Pushes a lightweight "something changed, re-fetch
// state" ping rather than the full state itself, since state depends on
// which viewer is asking (their own hole cards) in a way a single broadcast
// payload can't cleanly serve to every subscriber at once.
router.get('/:tableId/stream', async (req, res, next) => {
  let tableId;
  try {
    tableId = await CashGameManager.resolveTableId(req.db, req.params.tableId);
  } catch (err) {
    return next(new HttpError(400, err.message));
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();
  res.write(': connected\n\n');

  LiveHandEngine.subscribe(tableId, res);
  req.on('close', () => LiveHandEngine.unsubscribe(tableId, res));
});

// POST /cashgame/:tableId/seats/:seatIndex/take  { user_id, username, buy_in }
router.post('/:tableId/seats/:seatIndex/take', requireUser, async (req, res, next) => {
  try {
    const tableId = await CashGameManager.resolveTableId(req.db, req.params.tableId);
    const seatIndex = requireInt(req.params, 'seatIndex');
    const result = await CashGameManager.seatPlayer(req.db, String(req.user.id), tableId, seatIndex);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// POST /cashgame/:tableId/seats/:seatIndex/leave  { user_id }
router.post('/:tableId/seats/:seatIndex/leave', requireUser, async (req, res, next) => {
  try {
    const tableId = await CashGameManager.resolveTableId(req.db, req.params.tableId);
    const result = await CashGameManager.leaveTable(req.db, String(req.user.id), tableId);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// POST /cashgame/:tableId/start-hand  {} - only the seated player currently
// holding the dealer button may trigger the next hand, once >= 2 seats have
// chips and no hand is in progress. Same rule as the unauthenticated demo
// table (services/demo/createDemoRoom.js's dealHand) - see
// services/game/liveHandEngine.js's startHand() for the enforcement.
router.post('/:tableId/start-hand', requireUser, async (req, res, next) => {
  try {
    const tableId = await CashGameManager.resolveTableId(req.db, req.params.tableId);
    const result = await CashGameManager.startHand(req.db, tableId, String(req.user.id));
    res.json(result);
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// POST /cashgame/:tableId/action  { user_id, action, amount? }
// action: 'fold' | 'check' | 'call' | 'raise' (raise's `amount` is the
// target TOTAL street commitment, not just the increment).
router.post('/:tableId/action', requireUser, async (req, res, next) => {
  try {
    const tableId = await CashGameManager.resolveTableId(req.db, req.params.tableId);
    const action = requireString(req.body, 'action');
    const amount = req.body.amount != null ? Number(req.body.amount) : undefined;

    const result = await CashGameManager.applyAction(req.db, tableId, String(req.user.id), action, amount);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// GET /cashgame/:tableId/last-hand - mirrors /cashgame-demo/last-hand, for
// the /backtest page's "Live Table Hand" mode. 404 until a hand has
// completed at this table.
router.get('/:tableId/last-hand', async (req, res, next) => {
  try {
    const tableId = await CashGameManager.resolveTableId(req.db, req.params.tableId);
    const hand = CashGameManager.getLastCompletedHand(tableId);
    if (!hand) return res.status(404).json({ detail: 'No completed hand yet at this table.' });
    res.json(hand);
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// POST /cashgame/add_chips
router.post('/add_chips', async (req, res, next) => {
  try {
    const userId = requireString(req.body, 'user_id');
    const tableId = requireInt(req.body, 'table_id');
    const amount = requireFloat(req.body, 'amount');

    const result = await CashGameManager.addChips(req.db, userId, tableId, amount);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// POST /cashgame/settle_hand - still available for manual/admin use; the
// live engine calls SettlementManager directly rather than looping back
// through HTTP for its own showdown settlements.
router.post('/settle_hand', async (req, res, next) => {
  try {
    const tableId = requireInt(req.body, 'table_id');
    const pots = requireList(req.body, 'pots');
    const results = requireDict(req.body, 'results');

    const result = await CashGameManager.settleHand(req.db, tableId, pots, results);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// POST /cashgame/apply_rake
// Python reuses LeaveTableRequest (user_id, table_id) here even though only
// table_id is used - preserved as-is, including the unused user_id field.
router.post('/apply_rake', async (req, res, next) => {
  try {
    requireString(req.body, 'user_id'); // present in schema but unused, same as Python
    const tableId = requireInt(req.body, 'table_id');

    const result = await CashGameManager.applyRakeIfDue(req.db, tableId);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// POST /cashgame/:tableId/rebuy-onchain  { tx_hash }
// ADDED (USDC/Polygon integration). Player must already be seated and must
// have already linked a wallet (POST /wallet/onchain/link) and sent a
// fundTable() transaction on-chain before calling this - see
// services/blockchain/onchainRakeService.js's verifyAndCreditRebuy for the
// actual verification this performs before crediting anything.
router.post('/:tableId/rebuy-onchain', requireUser, async (req, res, next) => {
  try {
    const tableId = await CashGameManager.resolveTableId(req.db, req.params.tableId);
    const txHash = requireString(req.body, 'tx_hash');

    const result = await CashGameManager.rebuyFromChain(req.db, String(req.user.id), tableId, txHash);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

module.exports = router;
