// Converted from schemas/tournament.py - see schemas/user.js for the general
// note on why Pydantic schemas become plain helper functions here.

// NOTE: app.models.enums.{TournamentState, TournamentSize, TournamentStake} -
// see the sibling chunk's models/enums.js.
const { TournamentState, TournamentSize, TournamentStake } = require('../models/enums');

/**
 * TournamentCreate: { name: str, size: TournamentSize, stake: TournamentStake, is_freeroll: bool = False }
 */
function parseTournamentCreate(body) {
  const { name, size, stake } = body || {};
  const isFreeroll = body && 'is_freeroll' in body ? !!body.is_freeroll : false;

  if (typeof name !== 'string' || name.length === 0) {
    const err = new Error('name: field required');
    err.statusCode = 422;
    throw err;
  }
  if (!Object.values(TournamentSize).includes(size)) {
    const err = new Error(`size: must be one of ${Object.values(TournamentSize).join(', ')}`);
    err.statusCode = 422;
    throw err;
  }
  if (!Object.values(TournamentStake).includes(stake)) {
    const err = new Error(`stake: must be one of ${Object.values(TournamentStake).join(', ')}`);
    err.statusCode = 422;
    throw err;
  }

  return { name, size, stake, is_freeroll: isFreeroll };
}

/**
 * TournamentOut: { id, name, size, state, current_level, level_start_time,
 * level_end_time, max_players, max_players_per_table } (orm_mode=True).
 *
 * NOTE: this is a NARROWER field set than the `tournamentToDict()` shape
 * used elsewhere in the sibling chunk (models/tournament.js) - that one
 * includes buy-in breakdown, player counts, blinds, etc. which TournamentOut
 * does not. Where a route's Python source declared `response_model=TournamentOut`
 * specifically, this narrower shape is the more faithful conversion; the
 * earlier chunk's routers used `tournamentToDict()` as a stand-in before this
 * schema was available - see the README for which routes should switch to
 * this now that the real schema exists.
 */
function toTournamentOut(t) {
  return {
    id: t.id,
    name: t.name,
    size: t.size,
    state: t.state,
    current_level: t.current_level,
    level_start_time: t.level_start_time ? new Date(t.level_start_time).toISOString() : null,
    level_end_time: t.level_end_time ? new Date(t.level_end_time).toISOString() : null,
    max_players: t.max_players,
    max_players_per_table: t.max_players_per_table,
  };
}

module.exports = {
  parseTournamentCreate,
  toTournamentOut,
  TournamentState,
  TournamentSize,
  TournamentStake,
};
