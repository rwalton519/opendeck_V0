const crypto = require('crypto');

// -----------------------------------------------------------------
// ADDED (spec recommendation §7.4 / §12): real provably-fair commit/reveal
// deck engine. routers/rng.js and routers/game.js previously returned
// hardcoded mock values ('sha256_hash_of_seed', a fixed 3-card sample) for
// every request - there was no real shuffling, sealing, commitment, or
// verification logic anywhere in this codebase. This module is the real
// implementation those routers now call.
//
// Design (standard "commit-reveal with player cut" provably-fair pattern,
// the same shape used by most licensed online-poker RNG audits):
//
//   1. COMMIT   - server generates a secret random seed, shuffles a fresh
//                 52-card deck deterministically from that seed, and
//                 publishes only sha256(seed) (the "commitment") before
//                 anything is dealt. The seed and the shuffled deck order
//                 stay server-side.
//   2. CUT      - the player supplies a cut index (their own contribution
//                 of randomness). The server rotates the committed deck by
//                 that index. Only a commitment to the POST-CUT deck is
//                 published at this point, not the actual card values -
//                 publishing real card order before it's dealt would defeat
//                 the entire point of the scheme.
//   3. REVEAL   - once the game/hand is finished, the server publishes the
//                 seed and the real deck order (pre- and post-cut).
//   4. VERIFY   - anyone (the player, an auditor) can recompute
//                 sha256(seed), re-run the exact same deterministic
//                 shuffle, apply the same cut index, and confirm the
//                 results match what was committed to and what was
//                 actually used. If they don't match, the server cheated.
//
// Determinism note: Node's built-in Math.random() / crypto.randomInt() are
// NOT reproducible from a seed, so they can't be used for the shuffle step
// (a verifier needs to be able to re-derive the exact same permutation from
// the revealed seed). Instead, RANDOM BYTES ARE DERIVED FROM THE SEED VIA
// HMAC-SHA256 IN COUNTER MODE - a standard, simple deterministic random
// byte generator - and those bytes drive an unbiased Fisher-Yates shuffle.
// -----------------------------------------------------------------

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function freshDeck() {
  const deck = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck; // 52 cards, canonical unshuffled order
}

function generateSeed() {
  // 32 bytes of CSPRNG output, hex-encoded. This is the one place actual
  // non-deterministic randomness enters the system - everything downstream
  // of this is a deterministic, publicly-reproducible function of it.
  return crypto.randomBytes(32).toString('hex');
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function commitFor(seed) {
  return sha256Hex(seed);
}

/**
 * Deterministic random byte stream derived from `seed`, used as the entropy
 * source for the shuffle. HMAC-SHA256(seed, counter) for counter = 0, 1, 2,
 * ... concatenated - a standard, simple deterministic PRNG construction.
 * Given the same seed, this always produces the same byte stream, which is
 * exactly the property a provably-fair verifier depends on.
 */
function makeSeededByteStream(seed) {
  let counter = 0;
  let buffer = Buffer.alloc(0);
  let offset = 0;

  function refill() {
    buffer = crypto.createHmac('sha256', seed).update(String(counter)).digest();
    counter += 1;
    offset = 0;
  }

  return {
    nextUint32() {
      if (offset + 4 > buffer.length) refill();
      const value = buffer.readUInt32BE(offset);
      offset += 4;
      return value;
    },
  };
}

/**
 * Unbiased Fisher-Yates shuffle driven entirely by the seeded byte stream,
 * so it's fully reproducible from `seed` alone.
 */
function seededShuffle(deck, seed) {
  const cards = deck.slice();
  const stream = makeSeededByteStream(seed);

  for (let i = cards.length - 1; i > 0; i -= 1) {
    // Rejection sampling to avoid modulo bias when mapping a uint32 onto a
    // range of size (i + 1).
    const range = i + 1;
    const limit = Math.floor(0xffffffff / range) * range;
    let rand = stream.nextUint32();
    while (rand >= limit) rand = stream.nextUint32();
    const j = rand % range;

    [cards[i], cards[j]] = [cards[j], cards[i]];
  }

  return cards;
}

function cutDeck(deck, cutIndex) {
  const n = deck.length;
  const idx = ((cutIndex % n) + n) % n; // normalize negative/out-of-range indices
  return deck.slice(idx).concat(deck.slice(0, idx));
}

/**
 * Deterministically derives the full deck order (pre-cut) from a seed
 * alone. This is what both the server (at commit time) and any verifier
 * (at reveal time) call - same seed in, same 52-card order out, always.
 */
function deckFromSeed(seed) {
  return seededShuffle(freshDeck(), seed);
}

/**
 * Full independent verification: given a revealed seed, the commit that
 * was published up front, the cut index that was applied, and the deck
 * order that was actually used, recompute everything from scratch and
 * report whether each piece matches. Does not trust any stored "verified"
 * flag - recomputes both checks every time it's called.
 */
function verify({ seed, commit, cutIndex, deckAfterCut }) {
  const recomputedCommit = commitFor(seed);
  const commitMatches = recomputedCommit === commit;

  const recomputedDeckOriginal = deckFromSeed(seed);
  const recomputedDeckAfterCut = cutDeck(recomputedDeckOriginal, cutIndex);
  const deckMatches =
    Array.isArray(deckAfterCut) &&
    deckAfterCut.length === recomputedDeckAfterCut.length &&
    deckAfterCut.every((card, i) => card === recomputedDeckAfterCut[i]);

  return {
    verified: commitMatches && deckMatches,
    commitMatches,
    deckMatches,
    recomputedCommit,
    recomputedDeckOriginal,
    recomputedDeckAfterCut,
  };
}

module.exports = {
  freshDeck,
  generateSeed,
  commitFor,
  deckFromSeed,
  cutDeck,
  verify,
};
