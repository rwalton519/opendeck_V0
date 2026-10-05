// Blind schedule + prize-pool lookup share the single canonical Tournament
// model (models/tournament.js) now that services/game/models/tournamentModels.js
// (the old parallel GameTournament/JSONB model) has been removed - see
// MIGRATIONS.md "Tournament model consolidation" for the full history.
const { MODEST_BLIND_LEVELS } = require('../../models/tournament');

class StateManager {
  // CHANGED: accepts the optional live-hand-engine public state (see
  // services/game/liveHandEngine.js's getPublicState) so callers get one
  // merged snapshot - seats plus whatever hand is in progress - rather than
  // having to stitch two responses together on every poll/SSE tick.
  static getCashgameState(table, handState = null, nextDealerSeatIndex = null) {
    return {
      table_id: table.id,
      name: table.name,
      small_blind: table.small_blind,
      big_blind: table.big_blind,
      seats: table.seats || {},
      max_players: table.max_players,
      rake_enabled: table.rake_enabled,
      last_rake_time: table.last_rake_time ? String(table.last_rake_time) : null,
      hand: handState,
      // Who is allowed to deal the next hand - see
      // services/game/liveHandEngine.js's previewDealerSeatIndex(). Null
      // until at least 2 seats are occupied.
      next_dealer_seat_index: nextDealerSeatIndex,
    };
  }

  // CHANGED (tournament model consolidation - see MIGRATIONS.md): `t` is now
  // always a `models/tournament.js` Tournament instance. Per-player chip
  // stacks used to live in GameTournament's single `players` JSONB dict
  // (userId -> stack); they now live relationally on `TournamentRegistration.stack`,
  // one row per player, which is the only place chip stacks are tracked -
  // there is no more parallel/duplicate representation to keep in sync.
  //
  // Callers that need `players`/`is_running` populated (rather than the
  // defaults below) must eager-load registrations first, e.g.
  // `Tournament.findOne({ where: { id }, include: ['registrations'] })` -
  // same requirement models/tournament.js's own `tournamentToDict()` already
  // has for `registrations`/`tables`.
  static getTournamentState(t) {
    const registrations = t.registrations || [];
    const players = {};
    registrations.forEach((r) => {
      players[r.user_id] = {
        stack: r.stack,
        eliminated: r.eliminated,
        elimination_position: r.elimination_position,
        seat_number: r.seat_number,
        table_id: r.table_id,
      };
    });

    const prizePool = registrations.reduce(
      (sum, r) => sum + parseFloat(r.prize_pool_contribution || 0),
      0
    );

    const levelIdx = (t.current_level || 1) - 1;
    const levelInfo =
      levelIdx >= 0 && levelIdx < MODEST_BLIND_LEVELS.length ? MODEST_BLIND_LEVELS[levelIdx] : null;

    return {
      tournament_id: t.id,
      name: t.name,
      players,
      prize_pool: Math.round(prizePool * 100) / 100,
      current_level: t.current_level,
      level_info: levelInfo,
      is_running: t.state === 'RUNNING',
    };
  }
}

module.exports = StateManager;
