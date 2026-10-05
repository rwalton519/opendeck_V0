const crypto = require('crypto');

/**
 * Pure game-logic module for the Cash Game Demo. No session/room state
 * lives here (see cashGameDemoRoom.js) - just the deck/shuffle/fairness
 * primitives and hand evaluation, so they can be unit-tested in isolation
 * and so this file has nothing security-sensitive to reason about beyond
 * "does the math match what the client used to compute."
 *
 * This is a direct Node port of the client-side implementation that used
 * to live entirely in public/cashgame-demo/index.html (Web Crypto ->
 * Node's `crypto` module, otherwise identical byte-for-byte math), moved
 * server-side so the deck commit/shuffle is authoritative and hole cards
 * can actually be kept private between seats until showdown - a static
 * page with no backend has no way to hide one browser tab's cards from
 * another's.
 */

const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SUITS = ['s', 'h', 'd', 'c'];
const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));
const HAND_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

function newSeedHex() {
  return crypto.randomBytes(32).toString('hex');
}

// Provably-fair coin toss, same commit-style construction as the shuffle
// above: a fresh cryptographically-random seed is hashed with SHA-256 and
// the low bit of the hash's first byte decides the result (a fair 50/50
// split since a uniformly random byte is equally likely to be even or
// odd). Used to decide who deals first at tables that open with a coin
// flip instead of "first player to sit is dealer" - see createDemoRoom.js's
// `coinFlipDealer` option. Returns the seed/hash alongside the result so a
// caller can surface them the same way hand shuffles expose commitHash/
// revealSeed, if ever needed for verification.
function coinFlip() {
  const seedHex = newSeedHex();
  const hash = sha256HexOfHex(seedHex);
  const firstByte = parseInt(hash.slice(0, 2), 16);
  const result = firstByte % 2 === 0 ? 'heads' : 'tails';
  return { result, seedHex, hash };
}

function sha256HexOfHex(seedHex) {
  return crypto.createHash('sha256').update(Buffer.from(seedHex, 'hex')).digest('hex');
}

function commitHashFor(seedHex) {
  return sha256HexOfHex(seedHex);
}

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
function hmacShuffle(deck, seedHex) {
  const key = Buffer.from(seedHex, 'hex');
  const arr = deck.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const sig = crypto.createHmac('sha256', key).update(`shuffle:${i}`).digest();
    const rand = ((sig[0] << 24) | (sig[1] << 16) | (sig[2] << 8) | sig[3]) >>> 0;
    const j = rand % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

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
