const { CashGameTable } = require('./models/tableModels');
const BuyInManager = require('./buyinManager');
const SettlementManager = require('./settlementManager');
const RakeManager = require('./rakeManager');
const StateManager = require('./stateManager');
const LiveHandEngine = require('./liveHandEngine');
const User = require('../../models/user');
const WalletManager = require('../wallet/walletManager');

// Every cash table is 6-handed (matches the frontend's CASH_SEAT_COUNT and the
// Random Shuffle Test table layout).
const CASH_TABLE_SEATS = 6;

class CashGameManager {
  // ADDED: the frontend defaults to a non-numeric table id ("main" - see
  // DEFAULT_CASH_TABLE_ID in src/types/cashgame.ts) but CashGameTable.id is
  // an autoincrement integer PK, so that id was never resolvable before.
  // Numeric path params still resolve by primary key; anything else
  // resolves (and lazily creates, with $1/$2 default blinds) by `name`.
  static async resolveTableId(db, tableIdParam) {
    if (/^\d+$/.test(String(tableIdParam))) return Number(tableIdParam);

    let table = await CashGameTable.findOne({ where: { name: String(tableIdParam) } });
    if (!table) {
      table = await CashGameTable.create({
        name: String(tableIdParam),
        small_blind: 1,
        big_blind: 2,
        max_players: CASH_TABLE_SEATS,
        seats: {},
        created_at: new Date(),
      });
    }
    return table.id;
  }

  static async createTable(db, name, smallBlind, bigBlind, maxPlayers = CASH_TABLE_SEATS) {
    const table = await CashGameTable.create({
      name,
      small_blind: smallBlind,
      big_blind: bigBlind,
      max_players: maxPlayers,
      seats: {},
      created_at: new Date(),
    });
    return table;
  }

  static async getState(db, tableId, viewerUserId) {
    const table = await CashGameTable.findOne({ where: { id: tableId } });
    if (!table) {
      throw new Error('Table not found');
    }
    const handEngineState = LiveHandEngine.getState(tableId);
    const handPublicState = handEngineState.phase !== 'idle' || handEngineState.lastCompletedHand
      ? LiveHandEngine.getPublicState(handEngineState, table.seats || {}, viewerUserId)
      : null;
    // Exposed independently of `hand` (which is null until a hand has ever
    // been dealt) so the client can show/gate "Deal Next Hand" against the
    // correct seat from the moment a 2nd player sits down - see
    // previewDealerSeatIndex()'s doc comment.
    const active = LiveHandEngine.activeSeatIndices(table.seats || {});
    const nextDealerSeatIndex = LiveHandEngine.previewDealerSeatIndex(tableId, active);
    return StateManager.getCashgameState(table, handPublicState, nextDealerSeatIndex);
  }

  // CHANGED: seats are now taken by explicit seat INDEX (0-8), matching
  // src/types/cashgame.ts's CashSeatMap - see buyinManager.js's
  // cashgameTakeSeat for why.
  static async seatPlayer(db, userId, tableId, seatIndex) {
    const table = await CashGameTable.findOne({ where: { id: tableId } });
    if (!table) throw new Error('Table not found');
    // Tables created before the 6-seat change were stored with max_players 9;
    // cap at 6 so seats 6-8 can't be claimed from the API either.
    if (seatIndex < 0 || seatIndex >= Math.min(table.max_players, CASH_TABLE_SEATS)) {
      throw new Error('Invalid seat index for this table');
    }

    const user = await User.findByPk(String(userId));
    if (!user) throw new Error('User account not found');

    // A live seat is funded only from the authenticated account's currently
    // available wallet balance. The browser cannot choose another user's id
    // or an arbitrary buy-in amount. This keeps the visible table stack tied
    // to real account funds. Funds are frozen by BuyInManager while seated.
    const wallet = await WalletManager.getBalance(db, String(user.id));
    const buyinAmount = Number(wallet.available);
    if (!Number.isFinite(buyinAmount) || buyinAmount <= 0) {
      throw new Error('Deposit funds before taking a seat.');
    }

    await BuyInManager.cashgameTakeSeat(db, String(user.id), tableId, seatIndex, user.username, buyinAmount);
    const refreshed = await CashGameTable.findOne({ where: { id: tableId } });

    return {
      broadcast_state: true,
      table_id: tableId,
      state: StateManager.getCashgameState(refreshed),
      status: 'seated',
      user_id: String(user.id),
      username: user.username,
      seat_index: seatIndex,
      chips: buyinAmount,
    };
  }

  static async leaveTable(db, userId, tableId) {
    const table = await CashGameTable.findOne({ where: { id: tableId } });
    if (!table) {
      throw new Error('Table not found');
    }

    const result = await BuyInManager.cashgameCashout(db, userId, tableId);
    const refreshed = await CashGameTable.findOne({ where: { id: tableId } });

    return {
      broadcast_state: true,
      table_id: tableId,
      state: StateManager.getCashgameState(refreshed),
      status: 'left_table',
      user_id: userId,
      cashout: result.cashout,
    };
  }

  static async addChips(db, userId, tableId, amount) {
    const result = await BuyInManager.cashgameAddChips(db, userId, tableId, amount);
    const table = await CashGameTable.findOne({ where: { id: tableId } });

    return {
      broadcast_state: true,
      table_id: tableId,
      state: StateManager.getCashgameState(table),
      status: 'reload_success',
      user_id: userId,
      added_chips: amount,
      new_stack: result.chips,
    };
  }

  // ADDED (USDC/Polygon integration). Returns a FLAT table-state object -
  // matching startHand/applyAction's convention below, not the
  // {broadcast_state, state: {...}} wrapper addChips/seatPlayer use above -
  // since the frontend's rebuyOnChain() expects the same shape it already
  // gets back from every other in-hand action.
  static async rebuyFromChain(db, userId, tableId, txHash) {
    await BuyInManager.cashgameRebuyOnChain(db, userId, tableId, txHash);
    return CashGameManager.getState(db, tableId, userId);
  }

  static async settleHand(db, tableId, pots, results) {
    const settlement = await SettlementManager.settleCashgameHand(db, tableId, pots, results);
    const table = await CashGameTable.findOne({ where: { id: tableId } });

    return {
      broadcast_state: true,
      table_id: tableId,
      state: table ? StateManager.getCashgameState(table) : {},
      settlement,
    };
  }

  // ---- live hand dealing (see liveHandEngine.js) ----

  static async startHand(db, tableId, requestingUserId) {
    await LiveHandEngine.startHand(db, tableId, requestingUserId);
    return CashGameManager.getState(db, tableId);
  }

  static async applyAction(db, tableId, userId, action, amount) {
    await LiveHandEngine.applyAction(db, tableId, userId, action, amount);
    return CashGameManager.getState(db, tableId, userId);
  }

  static getLastCompletedHand(tableId) {
    return LiveHandEngine.getLastCompletedHand(tableId);
  }

  static async applyRakeIfDue(db, tableId) {
    const table = await CashGameTable.findOne({ where: { id: tableId } });
    if (!table) {
      throw new Error('Table not found');
    }

    const rake = await RakeManager.takeTimeRake(db, table);

    return {
      broadcast_state: true,
      table_id: tableId,
      state: StateManager.getCashgameState(table),
      rake_taken: parseFloat(rake),
      status: 'rake_applied',
    };
  }
}

module.exports = CashGameManager;
