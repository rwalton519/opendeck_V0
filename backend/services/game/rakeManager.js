const Decimal = require('decimal.js');

// REMOVED (dead-code cleanup, part of the tournament model consolidation -
// see MIGRATIONS.md): this class used to also carry
// settleCashgameHand/settleTournamentHand/finalizeTournament methods that
// were near-duplicates of the same-named, more complete methods on
// settlementManager.js (the ones with hand-history + collusion-engine
// integration). CashGameManager/TournamentManager have only ever called
// SettlementManager's versions, never these - they were confirmed
// dead/superseded code (this was already flagged, and preserved as-is, in
// the original chunk-conversion pass). Removing them here also removes the
// last reference to the now-deleted GameTournament model
// (services/game/models/tournamentModels.js) from this file. Only the real,
// actually-used method (takeTimeRake, called from
// settlementManager.js:settleCashgameHand) remains.

class RakeManager {
  /**
   * Deduct a time-based rake if the interval has elapsed.
   * Returns the rake amount taken (0 if not yet due).
   */
  static async takeTimeRake(db, table) {
    const now = new Date();
    const last = table.last_rake_time || now;

    const elapsedMinutes = (now.getTime() - new Date(last).getTime()) / 1000 / 60;
    if (elapsedMinutes < RakeManager.TIME_RAKE_INTERVAL_MINUTES) {
      return new Decimal('0');
    }

    const rake = new Decimal(String(RakeManager.TIME_RAKE_AMOUNT));

    // Spread the rake evenly across seated players
    const seats = table.seats || {};
    const activeSeatIndices = Object.keys(seats).filter((idx) => seats[idx] && seats[idx].chips > 0);

    if (activeSeatIndices.length > 0) {
      const perPlayer = rake.dividedBy(activeSeatIndices.length);
      for (const idx of activeSeatIndices) {
        seats[idx].chips = Math.max(0, seats[idx].chips - perPlayer.toNumber());
      }
    }

    table.seats = seats;
    table.changed('seats', true); // FIXED: JSONB mutated in place - Sequelize's dirty-check compares by reference and won't see this as changed without an explicit flag, so .save() would silently no-op and this write would be lost.
    table.last_rake_time = now;
    await table.save();

    return rake;
  }
}

RakeManager.TIME_RAKE_INTERVAL_MINUTES = 30;
RakeManager.TIME_RAKE_AMOUNT = 1; // $1 per interval per table

module.exports = RakeManager;
