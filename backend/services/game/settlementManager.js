const Decimal = require('decimal.js');
const WalletManager = require('../wallet/walletManager');
const { CashGameTable } = require('./models/tableModels');
// CHANGED (tournament model consolidation - see MIGRATIONS.md): GameTournament
// (services/game/models/tournamentModels.js) is gone. Tournament hand
// settlement now operates on the single canonical Tournament model, with
// per-player chip stacks on TournamentRegistration.
const { Tournament, TournamentRegistration } = require('../../models/tournament');
const { TournamentState } = require('../../models/enums');
const { PokerHand } = require('./models/handModels');
const RakeManager = require('./rakeManager');

// NOTE: app.models.hand_history.HandHistory - see the sibling chunk's
// models/hand_history.js (Sequelize model).
const HandHistory = require('../../models/hand_history');

const CollusionEngine = require('../compliance/collusionEngine');
// ADDED (USDC/Polygon integration): computes and best-effort executes the
// on-chain slice of a hand's rake once both gating conditions (flop + a
// bet) have already been checked off-chain in liveHandEngine.js. Never
// throws - see that module's doc comment for why an on-chain failure must
// never unwind an already-completed chip settlement.
const OnchainRakeService = require('../blockchain/onchainRakeService');

class SettlementManager {
  //
  // ---------------------------------------------------------
  // CASH GAME HAND SETTLEMENT
  // ---------------------------------------------------------
  //

  /**
   * pots example:
   *   [{ amount: 50, eligible_players: ["u1","u2"] }, { amount: 20, eligible_players: ["u1","u3"] }]
   * results example:
   *   { u1: 60, u2: 10, u3: 0 }
   *
   * `handOptions` (all optional, default {}):
   *   handNumber      - liveHandEngine.js's state.handNumber, used as part
   *                     of the on-chain replay-guard hand id.
   *   handRake        - the per-hand 5%-of-pot rake liveHandEngine.js
   *                     already computed and applied to `results` (i.e.
   *                     winners' amounts already have this deducted) -
   *                     recorded here for the hand-history/rake total, NOT
   *                     re-applied to chips a second time.
   *   totalPot        - the hand's total pot, for onchainRakeService's
   *                     apportionment math.
   *   seatSnapshots   - seatIndex -> { userId, chipsBeforeHand,
   *                     onchainStackBeforeHand }, captured before this
   *                     hand's chip changes were applied.
   * Manual/admin callers (e.g. the POST /cashgame/settle_hand route) that
   * don't supply these simply get the old behavior: time-based rake only,
   * no on-chain settlement attempt.
   */
  static async settleCashgameHand(db, tableId, pots, results, handOptions = {}) {
    const { handNumber = null, handRake = 0, totalPot = 0, seatSnapshots = {} } = handOptions;

    const table = await CashGameTable.findOne({ where: { id: tableId } });
    if (!table) {
      throw new Error('Table not found');
    }

    const seats = table.seats || {};

    // 1. Apply time-based rake
    const timeRakeAmount = await RakeManager.takeTimeRake(db, table);
    // Total rake recorded against this hand = the time-based table rake
    // (unrelated to this hand's own pot) plus the new per-hand 5%-of-pot
    // rake, which liveHandEngine.js has already worked into `results`
    // (winners' amounts already net of it) - this is purely bookkeeping,
    // not a second deduction.
    const rakeAmount = timeRakeAmount.plus(new Decimal(handRake || 0));

    // 2/3. Apply net chip deltas (results is { userId: netDelta }, positive
    // for winners, negative for losers - see liveHandEngine.js finishHand).
    // CHANGED: seats is now keyed by seat index (see buyinManager.js), so
    // look up which seat holds each userId rather than indexing directly.
    for (const [playerId, chipsWon] of Object.entries(results)) {
      const seatIndex = Object.keys(seats).find((idx) => seats[idx] && String(seats[idx].userId) === String(playerId));
      if (seatIndex === undefined) continue;
      seats[seatIndex].chips += chipsWon;
    }

    // 4. Convert chip changes into wallet operations
    for (const seatIndex of Object.keys(seats)) {
      const seat = seats[seatIndex];
      if (seat && seat.chips < 0) {
        // Player lost chips -> finalize locked funds
        // eslint-disable-next-line no-await-in-loop
        await WalletManager.finalizeLocked(db, seat.userId, Math.abs(seat.chips), `cashgame_loss:${tableId}`);
        seat.chips = 0;
      }
    }

    // 4b. ADDED (USDC integration): track each seat's on-chain-backed
    // portion of its stack forward through this hand, using the same
    // pre-hand ratio convention onchainRakeService.js uses to apportion
    // rake (seat.onchainStack / chipsBeforeHand). A win grows the on-chain
    // portion by that ratio of the win; a loss shrinks it by that ratio of
    // the loss; always clamped to [0, seat.chips] so it can never claim
    // more on-chain backing than the seat actually has in chips. This is
    // an accounting convention, not a literal trace of funds - see that
    // file's doc comment.
    for (const seatIndex of Object.keys(seats)) {
      const seat = seats[seatIndex];
      const snap = seatSnapshots[seatIndex];
      if (!seat || !snap || !(snap.chipsBeforeHand > 0)) continue;
      const ratio = Math.min(1, snap.onchainStackBeforeHand / snap.chipsBeforeHand);
      const netDelta = results[String(seat.userId)] || 0;
      const updated = snap.onchainStackBeforeHand + netDelta * ratio;
      seat.onchainStack = Math.max(0, Math.min(seat.chips, Math.round(updated * 100) / 100));
    }

    // 5. Save updated seat balances
    table.seats = seats;
    table.changed('seats', true); // FIXED: JSONB mutated in place - Sequelize's dirty-check compares by reference and won't see this as changed without an explicit flag, so .save() would silently no-op and this write would be lost.
    await table.save();

    // 6. Record hand in PokerHand table (existing model)
    const hand = await PokerHand.create({
      table_id: tableId,
      pots,
      results,
      rake: rakeAmount.toString(),
      created_at: new Date(),
    });

    // 7. Save Hand History for export (PokerStars-style)
    const handHistory = await HandHistory.create({
      table_id: tableId,
      hand_id: String(hand.id),
      raw: {
        table_id: tableId,
        hand_id: String(hand.id),
        pots,
        results,
        rake: rakeAmount.toNumber(),
      },
      created_at: new Date(),
    });

    // 8. Run Anti-Collusion Analysis
    await CollusionEngine.analyzeHand(db, {
      table_id: tableId,
      hand_id: String(hand.id),
      pots,
      results,
    });

    // 9. ADDED (USDC integration): best-effort sweep of the on-chain-backed
    // slice of this hand's rake, if any on-chain-backed chips were in play.
    // Deliberately fire-and-forget from the CALLER's perspective in terms
    // of failure handling (never throws - see onchainRakeService.js), but
    // awaited here so it completes (or is recorded as failed) before this
    // function returns, rather than racing the response.
    let onchainSettlement = { attempted: false };
    if (handNumber != null) {
      onchainSettlement = await OnchainRakeService.computeAndSettleHandOnchain(
        db,
        tableId,
        handNumber,
        seatSnapshots,
        results,
        totalPot,
        Number(handRake) || 0
      );
    }

    return {
      table_id: tableId,
      hand_id: hand.id,
      results,
      rake: rakeAmount.toNumber(),
      hand_rake: Number(handRake) || 0,
      onchain_settlement: onchainSettlement,
      status: 'hand_settled',
    };
  }

  //
  // ---------------------------------------------------------
  // TOURNAMENT HAND SETTLEMENT
  // ---------------------------------------------------------
  //

  /**
   * results: { player_id: chip_delta }. No rake in tournaments.
   *
   * CHANGED (tournament model consolidation - see MIGRATIONS.md): chip
   * deltas now apply to TournamentRegistration.stack rows (one per player)
   * instead of a GameTournament.players JSONB dict, so this is the single
   * place a tournament player's stack ever gets updated - the REST-API-facing
   * TournamentRegistration and the live-play chip count can no longer drift
   * apart into two different numbers for the same player.
   */
  static async settleTournamentHand(db, tournamentId, results) {
    const t = await Tournament.findOne({ where: { id: tournamentId } });
    if (!t) {
      throw new Error('Tournament not found');
    }

    const finalStacks = {};

    // 1. Apply chip deltas
    for (const [playerId, delta] of Object.entries(results)) {
      // eslint-disable-next-line no-await-in-loop
      const reg = await TournamentRegistration.findOne({
        where: { tournament_id: tournamentId, user_id: playerId },
      });
      if (!reg) continue;

      reg.stack += delta;
      if (reg.stack <= 0) {
        reg.stack = 0;
      }
      // eslint-disable-next-line no-await-in-loop
      await reg.save();
      finalStacks[playerId] = reg.stack;
    }

    // 2. Save tournament hand history
    const handId = `T${tournamentId}-${Date.now() / 1000}`;
    const handHistory = await HandHistory.create({
      table_id: tournamentId,
      hand_id: handId,
      raw: {
        tournament_id: tournamentId,
        results,
        players: finalStacks,
      },
      created_at: new Date(),
    });

    // 3. Run Anti-Collusion Analysis
    await CollusionEngine.analyzeHand(db, {
      table_id: tournamentId,
      hand_id: handHistory.hand_id,
      pots: [],
      results,
    });

    return {
      tournament_id: tournamentId,
      results,
      status: 'hand_settled',
    };
  }

  //
  // ---------------------------------------------------------
  // TOURNAMENT FINAL PAYOUTS
  // ---------------------------------------------------------
  //

  /**
   * payouts: { player_id: amount_in_usd }
   */
  static async finalizeTournament(db, tournamentId, payouts) {
    const t = await Tournament.findOne({ where: { id: tournamentId } });
    if (!t) {
      throw new Error('Tournament not found');
    }

    const registrations = await TournamentRegistration.findAll({
      where: { tournament_id: tournamentId },
    });

    // 1. Finalize all buy-ins (freeze -> finalize)
    for (const reg of registrations) {
      // eslint-disable-next-line no-await-in-loop
      await WalletManager.finalizeLocked(
        db,
        reg.user_id,
        parseFloat(t.buyin_total),
        `tournament_buyin_finalize:${tournamentId}`
      );
    }

    // 2. Pay winners
    for (const [playerId, amount] of Object.entries(payouts)) {
      // eslint-disable-next-line no-await-in-loop
      await WalletManager.credit(db, playerId, amount, `tournament_payout:${tournamentId}`);
    }

    // 3. Mark tournament as finished
    t.state = TournamentState.FINISHED;
    t.finished_at = new Date();
    await t.save();

    // 4. Save final payout history
    const finalStacks = {};
    registrations.forEach((reg) => {
      finalStacks[reg.user_id] = reg.stack;
    });
    const handHistory = await HandHistory.create({
      table_id: tournamentId,
      hand_id: `T${tournamentId}-final`,
      raw: {
        tournament_id: tournamentId,
        payouts,
        final_players: finalStacks,
      },
      created_at: new Date(),
    });

    // 5. Run Anti-Collusion Analysis on final payouts
    await CollusionEngine.analyzeHand(db, {
      table_id: tournamentId,
      hand_id: handHistory.hand_id,
      pots: [],
      results: payouts,
    });

    return {
      tournament_id: tournamentId,
      payouts,
      status: 'tournament_finalized',
    };
  }
}

module.exports = SettlementManager;
