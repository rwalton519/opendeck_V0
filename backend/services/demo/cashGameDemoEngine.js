'use strict';

// =====================================================================
// PUBLIC VERSION — proprietary shuffle protocol excluded
// =====================================================================
//
// This demo engine's seed / commit / shuffle functions belong to
// OpenDeck's proprietary provably fair commit-reveal protocol (subject
// of a provisional patent application) and are stubbed out in this
// public repository: they throw if called. The generic parts of the
// module — deck construction and standard 5-of-7 poker hand
// evaluation — are unchanged so the surrounding demo code loads and
// can be read end to end. The live product at opendeck.ca runs the
// full engine. See backend/services/rng/README.md.

function excludedError(fnName) {
  return new Error(
    `cashGameDemoEngine.${fnName} is part of OpenDeck's proprietary provably fair ` +
    'shuffle protocol and is excluded from this public repository. ' +
    'See backend/services/rng/README.md.'
  );
}

const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SUITS = ['s', 'h', 'd', 'c'];
const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));
const HAND_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

function newSeedHex() { throw excludedError('newSeedHex'); }

// Provably-fair coin toss, same commit-style construction as the shuffle
// above: a fresh cryptographically-random seed is hashed with SHA-256 and
// the low bit of the hash's first byte decides the result (a fair 50/50
// split since a uniformly random byte is equally likely to be even or
// odd). Used to decide who deals first at tables that open with a coin
// flip instead of "first player to sit is dealer" - see createDemoRoom.js's
// `coinFlipDealer` option. Returns the seed/hash alongside the result so a
// caller can surface them the same way hand shuffles expose commitHash/
// revealSeed, if ever needed for verification.
function coinFlip() { throw excludedError('coinFlip'); }

function commitHashFor() { throw excludedError('commitHashFor'); }

// Canonical pre-shuffle deck arrangement: suit-major, rank ascending
// within each suit (2..A), spades then hearts then diamonds then clubs.
function buildOrderedDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  return deck;
}

// HMAC-SHA256-seeded Fisher-Yates shuffle - same construction as the
// production fairness panel: HMAC(seed, "shuffle:<i>") for each swap index,
// first 4 bytes taken as a big-endian uint32 to pick the swap target.
function hmacShuffle() { throw excludedError('hmacShuffle'); }

// ---- hand evaluation: best 5-of-7, standard rankings incl. wheel straight ----

function popcount(x) { let c = 0; while (x) { c += x & 1; x >>= 1; } return c; }

function combos5of7(cards7) {
  const out = [];
  const n = cards7.length;
  for (let mask = 0; mask < (1 << n); mask++) {
    if (popcount(mask) !== 5) continue;
    const hand = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) hand.push(cards7[i]);
    out.push(hand);
  }
  return out;
}

function evaluate5(cards) {
  const values = cards.map((c) => RANK_VALUE[c.rank]).sort((a, b) => b - a);
  const suitsMatch = cards.every((c) => c.suit === cards[0].suit);

  const counts = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;
  const groups = Object.entries(counts)
    .map(([v, n]) => ({ v: Number(v), n }))
    .sort((a, b) => (b.n - a.n) || (b.v - a.v));

  const uniqueDesc = [...new Set(values)];
  let straightHigh = null;
  if (uniqueDesc.length >= 5) {
    for (let i = 0; i <= uniqueDesc.length - 5; i++) {
      if (uniqueDesc[i] - uniqueDesc[i + 4] === 4) { straightHigh = uniqueDesc[i]; break; }
    }
  }
  if (straightHigh === null && [14, 5, 4, 3, 2].every((v) => uniqueDesc.includes(v))) {
    straightHigh = 5; // wheel: A-2-3-4-5
  }

  const isFlush = suitsMatch;
  const isStraight = straightHigh !== null;

  if (isStraight && isFlush) return [8, straightHigh];
  if (groups[0].n === 4) return [7, groups[0].v, groups[1].v];
  if (groups[0].n === 3 && groups[1] && groups[1].n === 2) return [6, groups[0].v, groups[1].v];
  if (isFlush) return [5, ...values];
  if (isStraight) return [4, straightHigh];
  if (groups[0].n === 3) return [3, groups[0].v, ...groups.slice(1).map((g) => g.v)];
  if (groups[0].n === 2 && groups[1] && groups[1].n === 2) {
    const [hi, lo] = [groups[0].v, groups[1].v].sort((a, b) => b - a);
    return [2, hi, lo, groups[2].v];
  }
  if (groups[0].n === 2) return [1, groups[0].v, ...groups.slice(1).map((g) => g.v)];
  return [0, ...values];
}

function compareScores(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? -1;
    const bv = b[i] ?? -1;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function bestHand(cards7) {
  let best = null;
  for (const hand of combos5of7(cards7)) {
    const score = evaluate5(hand);
    if (!best || compareScores(score, best.score) > 0) best = { score, hand };
  }
  return best;
}

module.exports = {
  RANKS,
  SUITS,
  HAND_NAMES,
  newSeedHex,
  commitHashFor,
  buildOrderedDeck,
  hmacShuffle,
  coinFlip,
  bestHand,
  compareScores,
};
