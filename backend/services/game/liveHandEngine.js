const crypto = require('crypto');
const deckService = require('../rng/deckService');
// Hand evaluation (bestHand/compareScores/HAND_NAMES) is shared with the
// demo engine rather than duplicated - it's pure card-ranking math with no
// dependency on the demo's simplified shuffle, and RANK_VALUE keys match
// deckService's rank labels exactly ('2'..'10','J','Q','K','A').
const demoEngine = require('../demo/cashGameDemoEngine');
const { CashGameTable } = require('./models/tableModels');
const SettlementManager = require('./settlementManager');

// ADDED: table rake as specified for the USDC/on-chain integration - see
// contracts/OpenDeckPoker.sol and services/blockchain/onchainRakeService.js.
// Gating is exactly two conditions, both required: the hand reached the
// flop, AND at least one bet/raise occurred at any point in the hand. If
// either is false, no rake is taken at all (checked-down or
// everybody-folds-preflop hands are rake-free). This is enforced HERE,
// off-chain, before any on-chain call is ever made - the contract itself
// has no visibility into hand streets and cannot re-derive this condition.
const CASH_GAME_RAKE_PCT = 0.05; // 5% of the total pot

/**
 * ADDED: the actual live cash-game hand-dealing/betting engine. Previously
 * nothing in this codebase dealt cards for real-money cash-game tables -
 * services/game/stateManager.js only tracked seats/blinds, and
 * api/routes/cashgameRouter.js's /settle_hand expected a caller to have
 * already computed `pots`/`results` from a hand-resolution process that
 * didn't exist anywhere. This module IS that process.
 *
 * Design choices, and why:
 *
 *  - Uses the real services/rng/deckService.js commit/shuffle/cut/reveal
 *    pipeline (not the demo's simplified HMAC shuffle) - this is real
 *    money, so it gets the actual audited engine, rejection-sampling and
 *    all. See src/lib/fairness/liveVerifier.ts on the frontend for the
 *    matching independent client-side re-derivation.
 *  - Hand state lives in-memory per tableId (like the demo room), NOT in
 *    Postgres. Chip balances (CashGameTable.seats) are only ever mutated
 *    once, atomically, at showdown via SettlementManager - so a mid-hand
 *    server restart loses that hand's in-progress action log but can never
 *    double-charge or strand money in a half-applied bet. The practical
 *    cost: a crash mid-hand needs manual admin resolution (there's no
 *    hand-in-progress persistence to resume from). Worth revisiting if/when
 *    this needs to survive process restarts without any operator step.
 *  - Seats are keyed by seat INDEX (0-8), matching what
 *    src/types/cashgame.ts / CashGameTablePage.tsx already expect
 *    (`CashSeatMap = Record<number, CashSeatPlayer | null>`), rather than
 *    the userId-keyed dict the table model's seatPlayer()/leaveTable() used
 *    before this change. table.seats is JSONB (schema-less), so this is a
 *    shape change, not a migration.
 *  - No bet-timers / disconnect auto-fold / multi-table support. One table
 *    = one hand in progress at a time, advanced only by explicit action
 *    calls from seated players.
 */

const tables = new Map(); // tableId -> HandState

function freshState(tableId) {
  return {
    tableId,
    handNumber: 0,
    phase: 'idle', // idle | preflop | flop | turn | river | showdown
    dealerSeatIndex: null,
    order: [], // seatIndex[], ascending, active this hand
    dealOrder: [], // seatIndex[], dealing/showdown-reveal order (starts after BB)
    holeCards: {}, // seatIndex -> [{rank,suit}, {rank,suit}] (deckService card strings, parsed)
    communityCards: [],
    folded: new Set(),
    allIn: new Set(),
    committed: {}, // seatIndex -> total committed this hand
    streetCommitted: {}, // seatIndex -> committed this street
    actedThisStreet: new Set(),
    stackAtStart: {}, // seatIndex -> chip stack snapshot when the hand began
    currentBet: 0,
    minRaise: 0,
    sawFlop: false, // rake condition 1 - set true on the preflop->flop transition
    hadBet: false, // rake condition 2 - set true on any raise, any street
    toActSeatIndex: null,
    sbSeatIndex: null,
    bbSeatIndex: null,
    deckCommit: null,
    cutIndex: null,
    seed: null,
    deck: [],
    cursor: 0,
    lastCompletedHand: null,
    subscribers: new Set(), // SSE response objects
  };
}

function getState(tableId) {
  if (!tables.has(tableId)) tables.set(tableId, freshState(tableId));
  return tables.get(tableId);
}

function parseCard(cardStr) {
  // deckService cards are rank+suit concatenated, e.g. "AS", "10H".
  const suit = cardStr.slice(-1);
  const rank = cardStr.slice(0, -1);
  return { rank, suit: suit.toLowerCase() }; // lowercase to match demoEngine.RANK_VALUE/evaluate5 suit-equality checks
}

function broadcast(state) {
  const payload = JSON.stringify({ type: 'table_state' });
  for (const res of state.subscribers) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch {
      state.subscribers.delete(res);
    }
  }
}

function seatIndexForUser(seats, userId) {
  for (const [idx, seat] of Object.entries(seats)) {
    if (seat && String(seat.userId) === String(userId)) return Number(idx);
  }
  return null;
}

function activeSeatIndices(seats) {
  return Object.entries(seats)
    .filter(([, seat]) => seat && seat.chips > 0)
    .map(([idx]) => Number(idx))
    .sort((a, b) => a - b);
}

/** Next entry in `order` after `fromSeatIndex`, wrapping, skipping folded/all-in seats. Returns null if none remain. */
function nextToAct(state, fromSeatIndex) {
  const { order, folded, allIn } = state;
  const startPos = order.indexOf(fromSeatIndex);
  for (let step = 1; step <= order.length; step++) {
    const candidate = order[(startPos + step) % order.length];
    if (!folded.has(candidate) && !allIn.has(candidate)) return candidate;
  }
  return null;
}

function liveNonFolded(state) {
  return state.order.filter((s) => !state.folded.has(s));
}

function liveActionable(state) {
  return state.order.filter((s) => !state.folded.has(s) && !state.allIn.has(s));
}

// ---- dealing ----

async function startHand(db, tableId, requestingUserId) {
  const table = await CashGameTable.findOne({ where: { id: tableId } });
  if (!table) throw new Error('Table not found');
  const seats = table.seats || {};

  const state = getState(tableId);
  if (state.phase !== 'idle') throw new Error('A hand is already in progress');

  const active = activeSeatIndices(seats);
  if (active.length < 2) throw new Error('Need at least 2 players with chips to start a hand');

  // Rotate the button to the next active seat after the previous dealer.
  let dealerSeatIndex;
  if (state.dealerSeatIndex == null || !active.includes(state.dealerSeatIndex)) {
    dealerSeatIndex = active[0];
  } else {
    const prevPos = active.indexOf(state.dealerSeatIndex);
    dealerSeatIndex = active[(prevPos + 1) % active.length];
  }

  // Only the designated Dealer may deal the next hand - same rule the
  // unauthenticated demo table enforces (services/demo/createDemoRoom.js's
  // dealHand()). requestingUserId is optional only so internal/admin
  // callers that already bypass HTTP can still drive the engine directly;
  // the real /cashgame/:tableId/start-hand route always supplies it.
  if (requestingUserId != null) {
    const requesterSeat = seatIndexForUser(seats, requestingUserId);
    if (requesterSeat == null) throw new Error('You are not seated at this table.');
    if (requesterSeat !== dealerSeatIndex) {
      throw new Error('Only the designated Dealer can deal the next hand.');
    }
  }

  let sbSeatIndex;
  let bbSeatIndex;
  if (active.length === 2) {
    sbSeatIndex = dealerSeatIndex;
    bbSeatIndex = active[(active.indexOf(dealerSeatIndex) + 1) % active.length];
  } else {
    const dPos = active.indexOf(dealerSeatIndex);
    sbSeatIndex = active[(dPos + 1) % active.length];
    bbSeatIndex = active[(dPos + 2) % active.length];
  }
  const bbPos = active.indexOf(bbSeatIndex);
  const dealOrder = active.slice(bbPos + 1).concat(active.slice(0, bbPos + 1));

  // ---- real commit/shuffle/cut deal ----
  const seed = deckService.generateSeed();
  const deckCommit = deckService.commitFor(seed);
  const preCutDeck = deckService.deckFromSeed(seed);
  const cutIndex = crypto.randomInt(0, 52);
  const deck = deckService.cutDeck(preCutDeck, cutIndex);

  let cursor = 0;
  const holeCards = {};
  dealOrder.forEach((seatIndex) => (holeCards[seatIndex] = []));
  for (let round = 0; round < 2; round++) {
    for (const seatIndex of dealOrder) holeCards[seatIndex].push(deck[cursor++]);
  }

  const smallBlind = table.small_blind;
  const bigBlind = table.big_blind;

  const stackAtStart = {};
  active.forEach((seatIndex) => (stackAtStart[seatIndex] = seats[seatIndex].chips));

  const committed = {};
  const streetCommitted = {};
  active.forEach((seatIndex) => {
    committed[seatIndex] = 0;
    streetCommitted[seatIndex] = 0;
  });

  const sbAmount = Math.min(smallBlind, stackAtStart[sbSeatIndex]);
  const bbAmount = Math.min(bigBlind, stackAtStart[bbSeatIndex]);
  committed[sbSeatIndex] += sbAmount;
  streetCommitted[sbSeatIndex] += sbAmount;
  committed[bbSeatIndex] += bbAmount;
  streetCommitted[bbSeatIndex] += bbAmount;

  const allIn = new Set();
  if (sbAmount >= stackAtStart[sbSeatIndex]) allIn.add(sbSeatIndex);
  if (bbAmount >= stackAtStart[bbSeatIndex]) allIn.add(bbSeatIndex);

  Object.assign(state, {
    handNumber: state.handNumber + 1,
    phase: 'preflop',
    dealerSeatIndex,
    sbSeatIndex,
    bbSeatIndex,
    order: active,
    dealOrder,
    holeCards,
    communityCards: [],
    folded: new Set(),
    allIn,
    committed,
    streetCommitted,
    actedThisStreet: new Set(),
    stackAtStart,
    currentBet: bbAmount,
    minRaise: bigBlind,
    sawFlop: false,
    hadBet: false,
    deckCommit,
    cutIndex,
    seed,
    deck,
    cursor,
  });

  // First to act preflop: UTG (next active after BB) for 3+, or the
  // dealer/SB for heads-up (standard heads-up preflop rule).
  state.toActSeatIndex = active.length === 2 ? sbSeatIndex : nextToAct(state, bbSeatIndex) ?? sbSeatIndex;

  broadcast(state);
  return getPublicState(state, seats);
}

function advanceStreet(state) {
  state.streetCommitted = {};
  state.order.forEach((s) => (state.streetCommitted[s] = 0));
  state.currentBet = 0;
  state.minRaise = state.minRaise || 1;
  state.actedThisStreet = new Set();

  if (state.phase === 'preflop') {
    state.cursor += 1; // burn
    state.communityCards.push(state.deck[state.cursor], state.deck[state.cursor + 1], state.deck[state.cursor + 2]);
    state.cursor += 3;
    state.phase = 'flop';
    state.sawFlop = true;
  } else if (state.phase === 'flop') {
    state.cursor += 1;
    state.communityCards.push(state.deck[state.cursor]);
    state.cursor += 1;
    state.phase = 'turn';
  } else if (state.phase === 'turn') {
    state.cursor += 1;
    state.communityCards.push(state.deck[state.cursor]);
    state.cursor += 1;
    state.phase = 'river';
  }

  const actionable = liveActionable(state);
  state.toActSeatIndex = actionable.length > 0 ? (nextToAct(state, state.dealerSeatIndex) ?? actionable[0]) : null;
}

function bettingRoundComplete(state) {
  const actionable = liveActionable(state);
  if (actionable.length <= 1) return true; // everyone else folded or all-in - nothing left to bet
  return actionable.every((s) => state.streetCommitted[s] === state.currentBet && state.actedThisStreet.has(s));
}

/** Standard side-pot construction from per-player total commitments. Adjacent
 * layers that end up with the exact same eligible seats (e.g. a mid-hand
 * fold that doesn't correspond to any all-in tier) are merged into one pot,
 * since splitting them serves no purpose beyond a noisier settlement record. */
function buildPots(state) {
  const contributors = state.order.filter((s) => state.committed[s] > 0);
  const levels = [...new Set(contributors.map((s) => state.committed[s]))].sort((a, b) => a - b);

  const pots = [];
  let prevLevel = 0;
  for (const level of levels) {
    const layerContributors = contributors.filter((s) => state.committed[s] >= level);
    const amount = (level - prevLevel) * layerContributors.length;
    const eligible = layerContributors.filter((s) => !state.folded.has(s));
    if (amount > 0 && eligible.length > 0) {
      const prev = pots[pots.length - 1];
      const sameEligibility = prev && prev.eligibleSeats.length === eligible.length && prev.eligibleSeats.every((s, i) => s === eligible[i]);
      if (sameEligibility) {
        prev.amount += amount;
      } else {
        pots.push({ amount, eligibleSeats: eligible });
      }
    }
    prevLevel = level;
  }
  return pots;
}

async function finishHand(db, tableId, state, seats) {
  const nonFolded = liveNonFolded(state);
  let seatWinnings; // seatIndex -> total won across all pots

  if (nonFolded.length === 1) {
    // Uncontested - award the whole pot without a showdown, but still
    // reveal the seed for transparency (nothing to hide - no cards were
    // shown, but the deck itself is still provably the one committed to).
    const totalPot = Object.values(state.committed).reduce((a, b) => a + b, 0);
    seatWinnings = { [nonFolded[0]]: totalPot };
  } else {
    seatWinnings = {};
    state.order.forEach((s) => (seatWinnings[s] = 0));
    const evaluated = {};
    for (const s of nonFolded) {
      const seven = [...state.holeCards[s], ...state.communityCards].map(parseCard);
      evaluated[s] = demoEngine.bestHand(seven);
    }
    for (const pot of buildPots(state)) {
      const contenders = pot.eligibleSeats.filter((s) => evaluated[s]);
      if (contenders.length === 0) continue;
      let bestScore = evaluated[contenders[0]].score;
      let winners = [contenders[0]];
      for (const s of contenders.slice(1)) {
        const cmp = demoEngine.compareScores(evaluated[s].score, bestScore);
        if (cmp > 0) {
          bestScore = evaluated[s].score;
          winners = [s];
        } else if (cmp === 0) {
          winners.push(s);
        }
      }
      const share = Math.floor((pot.amount / winners.length) * 100) / 100;
      const remainder = Math.round((pot.amount - share * winners.length) * 100) / 100;
      winners.forEach((s, i) => {
        seatWinnings[s] = (seatWinnings[s] || 0) + share + (i === 0 ? remainder : 0);
      });
    }
  }

  // ---- table rake: 5% of the total pot, gated on BOTH the flop having
  // been reached AND at least one bet/raise having occurred this hand (see
  // state.sawFlop / state.hadBet above). Taken off the top of what winners
  // are paid, same as a standard cardroom drop - losers' amounts owed are
  // unaffected either way. See contracts/OpenDeckPoker.sol and
  // services/blockchain/onchainRakeService.js for where the USDC-backed
  // slice of this actually gets swept on-chain.
  const totalPot = Object.values(state.committed).reduce((a, b) => a + b, 0);
  let rakeAmount = 0;
  if (state.sawFlop && state.hadBet && totalPot > 0) {
    const totalWinnings = Object.values(seatWinnings).reduce((a, b) => a + b, 0);
    const proposedRake = Math.round(totalPot * CASH_GAME_RAKE_PCT * 100) / 100;
    if (totalWinnings > 0 && proposedRake > 0) {
      rakeAmount = Math.min(proposedRake, totalWinnings);
      const factor = (totalWinnings - rakeAmount) / totalWinnings;
      const seatKeys = Object.keys(seatWinnings);
      let redistributed = 0;
      seatKeys.forEach((s) => {
        const scaled = Math.round(seatWinnings[s] * factor * 100) / 100;
        redistributed += scaled;
        seatWinnings[s] = scaled;
      });
      // Rounding to the cent can leave a stray cent unaccounted for -
      // settle it against whichever seat won the most, rather than let the
      // pot silently gain or lose a cent.
      const roundingDiff = Math.round((totalWinnings - rakeAmount - redistributed) * 100) / 100;
      if (roundingDiff !== 0 && seatKeys.length > 0) {
        const biggest = seatKeys.reduce((a, b) => (seatWinnings[a] >= seatWinnings[b] ? a : b));
        seatWinnings[biggest] = Math.round((seatWinnings[biggest] + roundingDiff) * 100) / 100;
      }
    }
  }

  const resultsByUserId = {};
  const pots = nonFolded.length === 1
    ? [{ amount: Object.values(state.committed).reduce((a, b) => a + b, 0), eligible_players: [String(seats[nonFolded[0]].userId)] }]
    : buildPots(state).map((p) => ({ amount: p.amount, eligible_players: p.eligibleSeats.map((s) => String(seats[s].userId)) }));

  // Snapshot of each seat's chip stack and on-chain-backed portion as of
  // the START of this hand (state.stackAtStart), for onchainRakeService's
  // proportional apportionment - captured here, before settlement mutates
  // `seats`, since that's the only point both numbers are still accurate.
  const seatSnapshots = {};
  state.order.forEach((s) => {
    seatSnapshots[s] = {
      userId: String(seats[s].userId),
      chipsBeforeHand: state.stackAtStart[s] || 0,
      onchainStackBeforeHand: Number(seats[s].onchainStack || 0),
    };
  });

  state.order.forEach((s) => {
    const userId = String(seats[s].userId);
    const net = Math.round(((seatWinnings[s] || 0) - state.committed[s]) * 100) / 100;
    resultsByUserId[userId] = (resultsByUserId[userId] || 0) + net;
  });

  const settlement = await SettlementManager.settleCashgameHand(db, tableId, pots, resultsByUserId, {
    handNumber: state.handNumber,
    handRake: rakeAmount,
    totalPot,
    seatSnapshots,
  });

  state.lastCompletedHand = {
    handNumber: state.handNumber,
    dealerSeatIndex: state.dealerSeatIndex,
    sbSeatIndex: state.sbSeatIndex,
    bbSeatIndex: state.bbSeatIndex,
    activeSeats: state.order,
    dealOrder: state.dealOrder,
    seats: state.order.map((s) => ({
      seatIndex: s,
      userId: String(seats[s].userId),
      username: seats[s].username,
      holeCards: state.folded.has(s) ? [] : state.holeCards[s].map(parseCard),
    })),
    communityCards: state.communityCards.map(parseCard),
    resultsByUserId,
    deckCommit: state.deckCommit,
    cutIndex: state.cutIndex,
    revealSeed: state.seed,
    settledHandId: settlement.hand_id,
  };

  const refreshed = await CashGameTable.findOne({ where: { id: tableId } });
  state.phase = 'idle';
  state.toActSeatIndex = null;
  broadcast(state);
  return getPublicState(state, refreshed ? refreshed.seats : seats);
}

async function applyAction(db, tableId, userId, action, amount) {
  const table = await CashGameTable.findOne({ where: { id: tableId } });
  if (!table) throw new Error('Table not found');
  const seats = table.seats || {};

  const state = getState(tableId);
  if (state.phase === 'idle' || state.phase === 'showdown') throw new Error('No hand in progress');

  const seatIndex = seatIndexForUser(seats, userId);
  if (seatIndex == null) throw new Error('Player not seated at this table');
  if (state.toActSeatIndex !== seatIndex) throw new Error('Not your turn to act');

  const toCall = state.currentBet - state.streetCommitted[seatIndex];
  const available = state.stackAtStart[seatIndex] - state.committed[seatIndex];

  if (action === 'fold') {
    state.folded.add(seatIndex);
  } else if (action === 'check') {
    if (toCall > 0) throw new Error('Cannot check - there is a bet to call');
    state.actedThisStreet.add(seatIndex);
  } else if (action === 'call') {
    const callAmount = Math.min(toCall, available);
    state.committed[seatIndex] += callAmount;
    state.streetCommitted[seatIndex] += callAmount;
    if (callAmount >= available) state.allIn.add(seatIndex);
    state.actedThisStreet.add(seatIndex);
  } else if (action === 'raise') {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new Error('Raise requires a numeric amount');
    const targetStreetTotal = Math.min(amount, state.streetCommitted[seatIndex] + available);
    const raiseIncrement = targetStreetTotal - state.currentBet;
    const isAllIn = targetStreetTotal >= state.streetCommitted[seatIndex] + available;
    if (!isAllIn && raiseIncrement < state.minRaise) {
      throw new Error(`Raise must be at least ${state.minRaise} above the current bet`);
    }
    const delta = targetStreetTotal - state.streetCommitted[seatIndex];
    state.committed[seatIndex] += delta;
    state.streetCommitted[seatIndex] = targetStreetTotal;
    if (raiseIncrement > 0) state.minRaise = raiseIncrement;
    state.currentBet = targetStreetTotal;
    if (isAllIn) state.allIn.add(seatIndex);
    // A real raise reopens the action for everyone else still live.
    state.actedThisStreet = new Set([seatIndex]);
    state.hadBet = true; // rake condition 2 - a bet/raise occurred this hand
  } else {
    throw new Error(`Unknown action: ${action}`);
  }

  if (liveNonFolded(state).length === 1) {
    return finishHand(db, tableId, state, seats);
  }

  if (bettingRoundComplete(state)) {
    if (state.phase === 'river') {
      return finishHand(db, tableId, state, seats);
    }
    advanceStreet(state);
    if (liveActionable(state).length === 0) {
      // Everyone remaining is all-in - run out the rest of the board with
      // no more betting, then settle.
      while (state.phase !== 'river') advanceStreet(state);
      return finishHand(db, tableId, state, seats);
    }
  } else {
    state.toActSeatIndex = nextToAct(state, seatIndex);
  }

  broadcast(state);
  return getPublicState(state, seats);
}

// ---- state serialization ----

function getPublicState(state, seats, viewerUserId) {
  const holeCardsOut = {};
  if (state.phase !== 'idle') {
    for (const seatIndex of state.order) {
      const seat = seats[seatIndex];
      const isViewer = seat && viewerUserId != null && String(seat.userId) === String(viewerUserId);
      const showdownReveal = state.phase === 'idle' && state.lastCompletedHand && state.lastCompletedHand.handNumber === state.handNumber;
      if (isViewer || showdownReveal) {
        holeCardsOut[seatIndex] = (state.holeCards[seatIndex] || []).map(parseCard);
      }
    }
  }

  return {
    handNumber: state.handNumber,
    phase: state.phase,
    dealerSeatIndex: state.dealerSeatIndex,
    communityCards: state.communityCards.map(parseCard),
    pot: Object.values(state.committed).reduce((a, b) => a + b, 0),
    currentBet: state.currentBet,
    // FIXED: minRaise was computed and enforced server-side (applyAction's
    // 'raise' branch) but never surfaced here, so no client could know the
    // minimum legal raise without guessing/hardcoding - required for any
    // raise-amount UI (slider, +/- buttons, validation before submit).
    minRaise: state.minRaise,
    toActSeatIndex: state.toActSeatIndex,
    folded: [...state.folded],
    allIn: [...state.allIn],
    streetCommitted: state.streetCommitted,
    committed: state.committed,
    holeCards: holeCardsOut,
    deckCommit: state.phase !== 'idle' ? state.deckCommit : null,
  };
}

function getLastCompletedHand(tableId) {
  const state = tables.get(tableId);
  return state ? state.lastCompletedHand : null;
}

/**
 * What dealerSeatIndex *would* be if startHand() were called right now for
 * this table's currently-active seats - i.e. the same button-rotation math
 * as startHand(), without any side effects. Lets the frontend show/gate
 * "Deal Next Hand" against the correct seat even before any hand has ever
 * been played at this table (when state.dealerSeatIndex is still null and
 * `hand` itself is null), matching the demo table's behavior of the
 * designated Dealer being knowable as soon as two players are seated.
 * Returns null if fewer than 2 seats are active.
 */
function previewDealerSeatIndex(tableId, active) {
  if (!active || active.length < 2) return null;
  const state = getState(tableId);
  if (state.dealerSeatIndex == null || !active.includes(state.dealerSeatIndex)) {
    return active[0];
  }
  const prevPos = active.indexOf(state.dealerSeatIndex);
  return active[(prevPos + 1) % active.length];
}

function subscribe(tableId, res) {
  getState(tableId).subscribers.add(res);
}

function unsubscribe(tableId, res) {
  const state = tables.get(tableId);
  if (state) state.subscribers.delete(res);
}

module.exports = {
  startHand,
  applyAction,
  getPublicState,
  getLastCompletedHand,
  getState,
  previewDealerSeatIndex,
  activeSeatIndices,
  subscribe,
  unsubscribe,
};
