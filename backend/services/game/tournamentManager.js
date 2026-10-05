const BuyInManager = require('./buyinManager');
const StateManager = require('./stateManager');
const SettlementManager = require('./settlementManager');

// CHANGED (tournament model consolidation - see MIGRATIONS.md): this file
// used to operate on `GameTournament` (services/game/models/tournamentModels.js),
// a second, parallel tournament data model keyed by its own `game_tournaments.id`
// space - separate from `Tournament`/`TournamentRegistration`
// (models/tournament.js), which is what routers/tournaments.js (the REST
// API) and scheduler/tournamentScheduler.js actually read/write. That split
// meant a player registering through the live-event path below (WebSocket
// events dispatched by services/game/eventDispatcher.js) and one registering
// through the REST API ended up as two disconnected records, and this
// file's own `eliminatePlayer` had a standing bug where it looked up a
// `TournamentRegistration` by `tournament_id: tournamentId` using a
// `GameTournament.id` - a different table's ID space, so the lookup only
// coincidentally matched when the two ids happened to line up.
//
// This file now operates on the single canonical `Tournament` model, with
// per-player chip stacks living on `TournamentRegistration.stack` (one row
// per player) instead of a `players` JSONB blob. That both removes the
// duplicate model and fixes the ID-space bug outright: there is only one
// `tournament_id` space now.
const { Tournament, TournamentRegistration, MODEST_BLIND_LEVELS } = require('../../models/tournament');
const { TournamentState } = require('../../models/enums');

class TournamentManager {
  static async registerPlayer(db, userId, tournamentId) {
    await BuyInManager.tournamentBuyin(db, userId, tournamentId);

    const t = await Tournament.findOne({
      where: { id: tournamentId },
      include: ['registrations'],
    });

    return {
      broadcast_state: true,
      tournament_id: tournamentId,
      state: StateManager.getTournamentState(t),
      status: 'registered',
      user_id: userId,
    };
  }

  static async rebuy(db, userId, tournamentId) {
    await BuyInManager.tournamentRebuy(db, userId, tournamentId);

    const t = await Tournament.findOne({
      where: { id: tournamentId },
      include: ['registrations'],
    });

    return {
      broadcast_state: true,
      tournament_id: tournamentId,
      state: StateManager.getTournamentState(t),
      status: 'rebuy',
      user_id: userId,
    };
  }

  static async addon(db, userId, tournamentId, chips, cost) {
    await BuyInManager.tournamentAddon(db, userId, tournamentId, chips, cost);

    const t = await Tournament.findOne({
      where: { id: tournamentId },
      include: ['registrations'],
    });

    return {
      broadcast_state: true,
      tournament_id: tournamentId,
      state: StateManager.getTournamentState(t),
      status: 'addon',
      user_id: userId,
      chips,
    };
  }

  static async updateChips(db, tournamentId, results) {
    const exists = await Tournament.findOne({ where: { id: tournamentId } });
    if (!exists) {
      throw new Error('Tournament not found');
    }

    // SettlementManager exposes settleTournamentHand, not updateTournamentChips
    await SettlementManager.settleTournamentHand(db, tournamentId, results);

    const t = await Tournament.findOne({
      where: { id: tournamentId },
      include: ['registrations'],
    });

    return {
      broadcast_state: true,
      tournament_id: tournamentId,
      state: StateManager.getTournamentState(t),
      status: 'chips_updated',
    };
  }

  static async eliminatePlayer(db, userId, tournamentId) {
    const t = await Tournament.findOne({
      where: { id: tournamentId },
      include: ['registrations'],
    });
    if (!t) {
      throw new Error('Tournament not found');
    }

    // FIXED: this used to look up a TournamentRegistration by a
    // GameTournament id (see the file-level note above) - now `tournamentId`
    // and `TournamentRegistration.tournament_id` are the same id space, so
    // this lookup is correct by construction rather than by coincidence.
    // eslint-disable-next-line global-require
    const { eliminatePlayer: _elim } = require('../tournamentService');

    const reg = await TournamentRegistration.findOne({
      where: { tournament_id: tournamentId, user_id: userId },
    });
    if (reg) {
      await _elim(db, reg, t);
    }

    const refreshed = await Tournament.findOne({
      where: { id: tournamentId },
      include: ['registrations'],
    });

    return {
      broadcast_state: true,
      tournament_id: tournamentId,
      state: StateManager.getTournamentState(refreshed),
      status: 'eliminated',
      user_id: userId,
    };
  }

  // Admin-triggered manual level advance (POST /admin/tournament/advance_level).
  // Mirrors the same level-advance logic scheduler/tournamentScheduler.js
  // already runs automatically on a timer for every Tournament - this lets
  // an admin trigger the equivalent early/manually. `current_level` is
  // 1-indexed (see models/tournament.js's MODEST_BLIND_LEVELS lookup),
  // capped at the length of the blind schedule.
  static async advanceLevel(db, tournamentId) {
    const t = await Tournament.findOne({ where: { id: tournamentId } });
    if (!t) {
      throw new Error('Tournament not found');
    }

    const maxLevel = MODEST_BLIND_LEVELS.length;
    const nextLevel = Math.min((t.current_level || 1) + 1, maxLevel);

    t.current_level = nextLevel;
    t.level_start_time = new Date();
    if (t.level_duration_minutes) {
      t.level_end_time = new Date(Date.now() + t.level_duration_minutes * 60 * 1000);
    }
    if (t.state === TournamentState.WAITING) {
      t.state = TournamentState.RUNNING;
    }
    await t.save();

    const blindIdx = nextLevel - 1;
    const blindLevel = blindIdx >= 0 && blindIdx < MODEST_BLIND_LEVELS.length ? MODEST_BLIND_LEVELS[blindIdx] : null;

    const refreshed = await Tournament.findOne({
      where: { id: tournamentId },
      include: ['registrations'],
    });

    return {
      broadcast_state: true,
      tournament_id: tournamentId,
      state: StateManager.getTournamentState(refreshed),
      status: 'level_advanced',
      current_level: nextLevel,
      blind_level: blindLevel,
    };
  }

  static async finalize(db, tournamentId, payouts) {
    const exists = await Tournament.findOne({ where: { id: tournamentId } });
    if (!exists) {
      throw new Error('Tournament not found');
    }

    await SettlementManager.finalizeTournament(db, tournamentId, payouts);

    const t = await Tournament.findOne({
      where: { id: tournamentId },
      include: ['registrations'],
    });

    return {
      broadcast_state: true,
      tournament_id: tournamentId,
      state: StateManager.getTournamentState(t),
      status: 'finalized',
    };
  }
}

module.exports = TournamentManager;
