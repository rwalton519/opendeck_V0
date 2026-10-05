/**
 * Pure betting-round math for the unauthenticated demo tables
 * (services/demo/createDemoRoom.js). No room/session state lives here.
 *
 * This is a deliberate port of the same algorithm already proven out in
 * services/game/liveHandEngine.js (the real-money live engine's
 * nextToAct/bettingRoundComplete/buildPots) - adapted to work directly on
 * a demo room's `seats` array (keyed by seat index, chips mutated in place)
 * instead of a DB-backed table + userId-keyed committed/streetCommitted
 * maps. Reusing the same battle-tested rules here (rather than
 * inventing a second betting engine) is what keeps this demo's fold/
 * check/call/bet/raise behavior consistent with the real table's.
 */

/** Next seat index in `order` after `fromSeatIndex`, wrapping, skipping folded/all-in seats. Null if none remain. */
function nextToAct(bet, fromSeatIndex) {
  const { order, folded, allIn } = bet;
  const startPos = order.indexOf(fromSeatIndex);
  for (let step = 1; step <= order.length; step++) {
    const candidate = order[(startPos + step) % order.length];
    if (!folded.has(candidate) && !allIn.has(candidate)) return candidate;
  }
  return null;
}

function liveNonFolded(bet) {
  return bet.order.filter((s) => !bet.folded.has(s));
}

function liveActionable(bet) {
  return bet.order.filter((s) => !bet.folded.has(s) && !bet.allIn.has(s));
}

function bettingRoundComplete(bet) {
  const actionable = liveActionable(bet);
  if (actionable.length <= 1) return true; // everyone else folded or all-in - nothing left to bet
  return actionable.every((s) => bet.streetCommitted[s] === bet.currentBet && bet.actedThisStreet.has(s));
}

/** Standard side-pot construction from per-seat total commitments this hand. */
function buildPots(bet) {
  const contributors = bet.order.filter((s) => bet.committed[s] > 0);
  const levels = [...new Set(contributors.map((s) => bet.committed[s]))].sort((a, b) => a - b);

  const pots = [];
  let prevLevel = 0;
  for (const level of levels) {
    const layerContributors = contributors.filter((s) => bet.committed[s] >= level);
    const amount = Math.round((level - prevLevel) * layerContributors.length * 100) / 100;
    const eligible = layerContributors.filter((s) => !bet.folded.has(s));
    if (amount > 0 && eligible.length > 0) {
      const prev = pots[pots.length - 1];
      const sameEligibility = prev && prev.eligibleSeats.length === eligible.length && prev.eligibleSeats.every((s, i) => s === eligible[i]);
      if (sameEligibility) {
        prev.amount = Math.round((prev.amount + amount) * 100) / 100;
      } else {
        pots.push({ amount, eligibleSeats: eligible });
      }
    }
    prevLevel = level;
  }
  return pots;
}

/**
 * Applies one action from `seatIndex`, mutating `bet` and `chipsBySeat`
 * (a { seatIndex -> current chip count } accessor object - the demo room
 * mutates seat.chips directly through this rather than a separate
 * stackAtStart/committed split, since chips are decremented immediately as
 * each bet/call/raise is made).
 *
 * Throws a plain Error with a user-facing message on any illegal action -
 * callers should catch and surface `err.message` (same convention as the
 * rest of createDemoRoom.js's `{ ok: false, error }` returns).
 */
function applyAction(bet, chipsBySeat, seatIndex, type, amount) {
  if (bet.toActSeatIndex !== seatIndex) throw new Error('Not your turn to act.');

  const toCall = bet.currentBet - (bet.streetCommitted[seatIndex] || 0);
  const available = chipsBySeat[seatIndex];

  if (type === 'fold') {
    bet.folded.add(seatIndex);
  } else if (type === 'check') {
    if (toCall > 0) throw new Error('There is a bet to call - you cannot check.');
    bet.actedThisStreet.add(seatIndex);
  } else if (type === 'call') {
    const callAmount = Math.min(toCall, available);
    chipsBySeat[seatIndex] -= callAmount;
    bet.committed[seatIndex] = (bet.committed[seatIndex] || 0) + callAmount;
    bet.streetCommitted[seatIndex] = (bet.streetCommitted[seatIndex] || 0) + callAmount;
    if (callAmount >= available) bet.allIn.add(seatIndex);
    bet.actedThisStreet.add(seatIndex);
  } else if (type === 'bet' || type === 'raise') {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Enter a valid ${type} amount.`);
    }
    const streetCommittedNow = bet.streetCommitted[seatIndex] || 0;
    const targetStreetTotal = Math.round(Math.min(amount, streetCommittedNow + available) * 100) / 100;
    const raiseIncrement = Math.round((targetStreetTotal - bet.currentBet) * 100) / 100;
    if (raiseIncrement <= 0) throw new Error(`${type === 'bet' ? 'Bet' : 'Raise'} must be more than the current bet.`);
    const isAllIn = targetStreetTotal >= streetCommittedNow + available;
    if (!isAllIn && raiseIncrement < bet.minRaise) {
      throw new Error(`Must ${type === 'bet' ? 'bet' : 'raise to'} at least ${(bet.currentBet + bet.minRaise).toFixed(2)}.`);
    }
    const delta = Math.round((targetStreetTotal - streetCommittedNow) * 100) / 100;
    chipsBySeat[seatIndex] -= delta;
    bet.committed[seatIndex] = Math.round(((bet.committed[seatIndex] || 0) + delta) * 100) / 100;
    bet.streetCommitted[seatIndex] = targetStreetTotal;
    if (raiseIncrement > 0) bet.minRaise = raiseIncrement;
    bet.currentBet = targetStreetTotal;
    if (isAllIn) bet.allIn.add(seatIndex);
    // A real bet/raise reopens the action for everyone else still live.
    bet.actedThisStreet = new Set([seatIndex]);
  } else {
    throw new Error(`Unknown action: ${type}`);
  }
}

/** Resets per-street trackers for the next street (call after pushing new community cards / bumping bet.streetName). */
function resetStreetTracking(bet, bigBlind, dealerSeat) {
  bet.streetCommitted = {};
  bet.order.forEach((s) => { bet.streetCommitted[s] = 0; });
  bet.currentBet = 0;
  bet.minRaise = bigBlind;
  bet.actedThisStreet = new Set();

  const actionable = liveActionable(bet);
  bet.toActSeatIndex = actionable.length > 0 ? (nextToAct(bet, dealerSeat) ?? actionable[0]) : null;
}

function totalPot(bet) {
  return Math.round(bet.order.reduce((sum, s) => sum + (bet.committed[s] || 0), 0) * 100) / 100;
}

module.exports = {
  nextToAct,
  liveNonFolded,
  liveActionable,
  bettingRoundComplete,
  buildPots,
  applyAction,
  resetStreetTracking,
  totalPot,
};
