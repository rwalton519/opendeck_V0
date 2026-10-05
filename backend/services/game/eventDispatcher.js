class GameEventDispatcher {
  static async handleEvent(db, event) {
    // Mirrors the original Python's lazy (function-scoped) imports, done
    // there to avoid a circular import between event_dispatcher.py and
    // cashgame_manager.py/tournament_manager.py.
    // eslint-disable-next-line global-require
    const CashGameManager = require('./cashgameManager');
    // eslint-disable-next-line global-require
    const TournamentManager = require('./tournamentManager');

    const t = event.type;

    if (t === 'cashgame_hand_complete') {
      return CashGameManager.settleHand(db, event.table_id, event.pots, event.results);
    }

    if (t === 'cashgame_seat_player') {
      return CashGameManager.seatPlayer(db, event.user_id, event.table_id, event.buyin_amount);
    }

    if (t === 'cashgame_leave') {
      return CashGameManager.leaveTable(db, event.user_id, event.table_id);
    }

    if (t === 'cashgame_add_chips') {
      return CashGameManager.addChips(db, event.user_id, event.table_id, event.amount);
    }

    if (t === 'cashgame_apply_rake') {
      return CashGameManager.applyRakeIfDue(db, event.table_id);
    }

    if (t === 'tournament_register') {
      return TournamentManager.registerPlayer(db, event.user_id, event.tournament_id);
    }

    if (t === 'tournament_rebuy') {
      return TournamentManager.rebuy(db, event.user_id, event.tournament_id);
    }

    if (t === 'tournament_addon') {
      return TournamentManager.addon(db, event.user_id, event.tournament_id, event.chips, event.cost);
    }

    if (t === 'tournament_hand_complete') {
      return TournamentManager.updateChips(db, event.tournament_id, event.results);
    }

    if (t === 'tournament_eliminate') {
      return TournamentManager.eliminatePlayer(db, event.user_id, event.tournament_id);
    }

    if (t === 'tournament_finalize') {
      return TournamentManager.finalize(db, event.tournament_id, event.payouts);
    }

    return { status: 'ignored', reason: `Unknown event type: ${t}` };
  }
}

module.exports = GameEventDispatcher;
