const WalletManager = require('../wallet/walletManager');
const ComplianceManager = require('../compliance/complianceManager');
// ADDED (USDC/Polygon integration): verifies a player's on-chain
// fundTable() transaction before any chips are credited - see
// services/blockchain/onchainRakeService.js.
const OnchainRakeService = require('../blockchain/onchainRakeService');

const { CashGameTable } = require('./models/tableModels');
// CHANGED (tournament model consolidation - see MIGRATIONS.md): the old
// GameTournament JSONB model (services/game/models/tournamentModels.js) has
// been removed. Tournament buy-ins now operate on the single canonical
// Tournament model, with per-player chip stacks on TournamentRegistration
// rather than a `players` JSONB dict.
const { Tournament, TournamentRegistration } = require('../../models/tournament');

class BuyInManager {
  //
  // -----------------------------
  // CASH GAME BUY-INS
  // -----------------------------
  //

  /**
   * Cash game buy-in - takes a NEW seat. 1 chip = $1. Funds are frozen
   * until player leaves the table.
   *
   * CHANGED: table.seats is now keyed by seat INDEX (0-8), holding
   * { userId, username, chips }, matching what the frontend's
   * CashSeatMap/CashGameTablePage.tsx already expect (`Record<number,
   * CashSeatPlayer | null>`) - it was previously keyed by userId with a
   * bare chip number, which the frontend never actually spoke.
   */
  static async cashgameTakeSeat(db, userId, tableId, seatIndex, username, amount) {
    const table = await CashGameTable.findOne({ where: { id: tableId } });
    if (!table) {
      throw new Error('Table not found');
    }

    const seats = table.seats || {};
    if (seats[seatIndex]) {
      throw new Error('Seat is already taken');
    }
    if (Object.values(seats).some((seat) => seat && String(seat.userId) === String(userId))) {
      throw new Error('Player already seated at this table');
    }

    // Compliance check
    await ComplianceManager.runChecks(db, userId, amount);

    // Freeze funds
    await WalletManager.freeze(db, userId, amount, `cashgame_buyin:${tableId}`);

    seats[seatIndex] = { userId, username, chips: amount, onchainStack: 0 };
    table.seats = seats;
    table.changed('seats', true); // FIXED: JSONB mutated in place - Sequelize's dirty-check compares by reference and won't see this as changed without an explicit flag, so .save() would silently no-op and this write would be lost.
    await table.save();

    return {
      table_id: tableId,
      user_id: userId,
      seat_index: seatIndex,
      chips: amount,
      status: 'buyin_success',
    };
  }

  /** Top up an EXISTING seat (already seated). */
  static async cashgameAddChips(db, userId, tableId, amount) {
    const table = await CashGameTable.findOne({ where: { id: tableId } });
    if (!table) {
      throw new Error('Table not found');
    }

    const seats = table.seats || {};
    const seatIndex = Object.keys(seats).find((idx) => seats[idx] && String(seats[idx].userId) === String(userId));
    if (seatIndex === undefined) {
      throw new Error('Player not seated');
    }

    // Compliance check
    await ComplianceManager.runChecks(db, userId, amount);

    // Freeze funds
    await WalletManager.freeze(db, userId, amount, `cashgame_buyin:${tableId}`);

    seats[seatIndex].chips += amount;
    table.seats = seats;
    table.changed('seats', true); // FIXED: JSONB mutated in place - Sequelize's dirty-check compares by reference and won't see this as changed without an explicit flag, so .save() would silently no-op and this write would be lost.
    await table.save();

    return {
      table_id: tableId,
      user_id: userId,
      seat_index: Number(seatIndex),
      chips: seats[seatIndex].chips,
      status: 'buyin_success',
    };
  }

  /**
   * Cash-out from a cash game. Unused chips are unfrozen. Chips lost are finalized.
   */
  static async cashgameCashout(db, userId, tableId) {
    const table = await CashGameTable.findOne({ where: { id: tableId } });
    if (!table) {
      throw new Error('Table not found');
    }

    const seats = table.seats || {};
    const seatIndex = Object.keys(seats).find((idx) => seats[idx] && String(seats[idx].userId) === String(userId));
    if (seatIndex === undefined) {
      throw new Error('Player not seated');
    }

    const chips = seats[seatIndex].chips;

    // Unfreeze or finalize
    if (chips > 0) {
      await WalletManager.unfreeze(db, userId, chips, `cashgame_cashout:${tableId}`);
    } else {
      await WalletManager.finalizeLocked(db, userId, Math.abs(chips), `cashgame_loss:${tableId}`);
    }

    // Remove player from table
    delete seats[seatIndex];
    table.seats = seats;
    table.changed('seats', true); // FIXED: JSONB mutated in place - Sequelize's dirty-check compares by reference and won't see this as changed without an explicit flag, so .save() would silently no-op and this write would be lost.
    await table.save();

    // ADDED (USDC integration): clear the on-chain withdrawal lock (if this
    // player ever rebought with USDC at this table) - best-effort, doesn't
    // block cashout on chain availability.
    await OnchainRakeService.releaseSeatLock(db, userId, tableId);

    return {
      table_id: tableId,
      user_id: userId,
      seat_index: Number(seatIndex),
      cashout: chips,
      status: 'cashout_success',
    };
  }

  /**
   * ADDED (USDC/Polygon integration): rebuy an EXISTING seat using a
   * verified on-chain USDC deposit instead of the off-chain wallet balance.
   * The player must have already (1) linked a wallet (POST
   * /wallet/onchain/link) and (2) sent a fundTable() transaction on-chain
   * for this exact tableId/amount from that wallet - `txHash` is that
   * transaction's hash. See services/blockchain/onchainRakeService.js's
   * verifyAndCreditRebuy for the actual on-chain verification; this method
   * only handles crediting the seat once that verification has succeeded.
   *
   * Deliberately does NOT go through WalletManager.freeze/ComplianceManager
   * - the funds here were never in the off-chain wallet to begin with, they
   * came from the player's own on-chain balance, which the contract itself
   * already gates (see OpenDeckPoker.sol's fundTable). Running the same
   * fiat AML compliance checks against on-chain-sourced funds would need
   * its own design (source-of-funds checks for a self-custody wallet are a
   * different problem than a card deposit) - flagged as NOT handled here
   * rather than silently skipped without a note.
   */
  static async cashgameRebuyOnChain(db, userId, tableId, txHash) {
    const table = await CashGameTable.findOne({ where: { id: tableId } });
    if (!table) {
      throw new Error('Table not found');
    }

    const seats = table.seats || {};
    const seatIndex = Object.keys(seats).find((idx) => seats[idx] && String(seats[idx].userId) === String(userId));
    if (seatIndex === undefined) {
      throw new Error('Player not seated - take a seat before rebuying.');
    }

    const { amount, address } = await OnchainRakeService.verifyAndCreditRebuy(db, userId, tableId, txHash);

    seats[seatIndex].chips += amount;
    seats[seatIndex].onchainStack = (seats[seatIndex].onchainStack || 0) + amount;
    table.seats = seats;
    table.changed('seats', true); // FIXED: JSONB mutated in place - Sequelize's dirty-check compares by reference and won't see this as changed without an explicit flag, so .save() would silently no-op and this write would be lost.
    await table.save();

    return {
      table_id: tableId,
      user_id: userId,
      seat_index: Number(seatIndex),
      chips: seats[seatIndex].chips,
      onchain_stack: seats[seatIndex].onchainStack,
      added_chips: amount,
      wallet_address: address,
      status: 'rebuy_success',
    };
  }

  //
  // -----------------------------
  // TOURNAMENT BUY-INS
  // -----------------------------
  //

  /**
   * Tournament buy-in. Funds are frozen until tournament ends.
   *
   * CHANGED: previously created/updated an entry in GameTournament's
   * `players` JSONB dict. Now creates the TournamentRegistration row that
   * routers/tournaments.js and the scheduler already read/write - so a
   * player registering through the live-event path (this method, via
   * services/game/tournamentManager.js) and one registering through the
   * REST API (services/tournamentService.js) land in the exact same place,
   * instead of two disconnected tournament records.
   */
  static async tournamentBuyin(db, userId, tournamentId) {
    const t = await Tournament.findOne({ where: { id: tournamentId } });
    if (!t) {
      throw new Error('Tournament not found');
    }

    const amount = parseFloat(t.buyin_total);

    const existing = await TournamentRegistration.findOne({
      where: { tournament_id: tournamentId, user_id: userId },
    });
    if (existing) {
      throw new Error('Player already registered');
    }

    // Compliance check
    await ComplianceManager.runChecks(db, userId, amount);

    // Freeze funds
    await WalletManager.freeze(db, userId, amount, `tournament_buyin:${tournamentId}`);

    // Assign starting stack + register
    await TournamentRegistration.create({
      tournament_id: tournamentId,
      user_id: userId,
      stack: t.starting_stack,
      prize_pool_contribution: parseFloat(t.buyin_prize_pool),
    });

    return {
      tournament_id: tournamentId,
      user_id: userId,
      chips: t.starting_stack,
      status: 'registered',
    };
  }

  /**
   * Tournament rebuy. Same cost as buy-in. Adds starting stack again.
   */
  static async tournamentRebuy(db, userId, tournamentId) {
    const t = await Tournament.findOne({ where: { id: tournamentId } });
    if (!t) {
      throw new Error('Tournament not found');
    }

    const reg = await TournamentRegistration.findOne({
      where: { tournament_id: tournamentId, user_id: userId },
    });
    if (!reg) {
      throw new Error('Player not in tournament');
    }

    const amount = parseFloat(t.buyin_total);

    // Compliance
    await ComplianceManager.runChecks(db, userId, amount);

    // Freeze funds
    await WalletManager.freeze(db, userId, amount, `tournament_rebuy:${tournamentId}`);

    // Add chips + prize-pool contribution
    reg.stack += t.starting_stack;
    reg.eliminated = false;
    reg.elimination_position = null;
    reg.prize_pool_contribution = parseFloat(reg.prize_pool_contribution || 0) + parseFloat(t.buyin_prize_pool);
    await reg.save();

    return {
      tournament_id: tournamentId,
      user_id: userId,
      chips_added: t.starting_stack,
      new_stack: reg.stack,
      status: 'rebuy_success',
    };
  }

  /**
   * Tournament add-on. Custom chip amount and cost.
   */
  static async tournamentAddon(db, userId, tournamentId, chips, cost) {
    const t = await Tournament.findOne({ where: { id: tournamentId } });
    if (!t) {
      throw new Error('Tournament not found');
    }

    const reg = await TournamentRegistration.findOne({
      where: { tournament_id: tournamentId, user_id: userId },
    });
    if (!reg) {
      throw new Error('Player not in tournament');
    }

    // Compliance
    await ComplianceManager.runChecks(db, userId, cost);

    // Freeze funds
    await WalletManager.freeze(db, userId, cost, `tournament_addon:${tournamentId}`);

    // Add chips + prize-pool contribution (the full add-on cost, same as
    // the original GameTournament-based behavior)
    reg.stack += chips;
    reg.prize_pool_contribution = parseFloat(reg.prize_pool_contribution || 0) + parseFloat(cost);
    await reg.save();

    return {
      tournament_id: tournamentId,
      user_id: userId,
      chips_added: chips,
      new_stack: reg.stack,
      status: 'addon_success',
    };
  }
}

module.exports = BuyInManager;
