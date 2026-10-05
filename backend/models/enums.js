// Converted from models/enums.py's `class X(str, enum.Enum)` definitions.
// Plain frozen objects are used rather than a JS enum library since Python's
// str-enum members serialize as their string value, which these mirror directly.

const TournamentState = Object.freeze({
  WAITING: 'WAITING',
  RUNNING: 'RUNNING',
  BREAK: 'BREAK',
  FINISHED: 'FINISHED',
});

const TournamentSize = Object.freeze({
  MICRO: 'MICRO',
  STANDARD: 'STANDARD',
  LARGE: 'LARGE',
});

const TournamentStake = Object.freeze({
  NANO: 'NANO',
  MICRO: 'MICRO',
  MID: 'MID',
  MACRO: 'MACRO',
});

module.exports = { TournamentState, TournamentSize, TournamentStake };
