'use strict';

const crypto = require('crypto');

// =====================================================================
// OpenDeck — Commit-Reveal RNG Engine
// =====================================================================
//
// Standalone extraction of OpenDeck's provably-fair deck engine. This
// file has exactly one dependency: Node's built-in `crypto` module. It
// does not import Sequelize, Express, or any other project module, and
// it does not perform any I/O (no DB access, no HTTP). Every function
// here is a pure function of its arguments. This is deliberate: a
// commitment/verification engine should be trivially auditable in
// isolation, and callers (HTTP routers, hand engines, persistence
// layers) are expected to wrap it, not be woven into it.
//
// SOURCE OF THIS EXTRACTION
// -------------------------
// Consolidated from services/rng/deckService.js, which is the engine
// actually wired into routers/rng.js, routers/game.js, and
// services/game/liveHandEngine.js. One addition was folded in during
// extraction: `commitForDeck()` below replaces a hash computation that
// was duplicated inline in routers/game.js (`POST /:game_id/cut`) —
//
//     crypto.createHash('sha256')
//       .update(JSON.stringify(deckAfterCut), 'utf8')
//       .digest('hex')
//
// — instead of being a call into the engine itself. That means every
// hash in the commit-reveal lifecycle (initial commit, post-cut
// commit, and verification) now has exactly one implementation. The
// `verify()` function below is likewise extended to optionally check
// a post-cut commitment, which routers/game.js's own verify handler
// did not previously do (it only checked the initial commit + final
// deck order, not whether the published post-cut hash matched the
// deck that was actually cut). Callers should be updated to use these
// instead of re-deriving hashes locally; that router-side change is
// not included here, since it touches call sites outside this file.
//
// NOTE ON "ENCRYPTED": nothing in this engine encrypts anything (no
// AES, no cipher, no decrypt step anywhere in the codebase this was
// extracted from). It is a cryptographic COMMITMENT scheme built from
// SHA-256 hashing and HMAC-SHA256, which is the correct primitive for
// commit-reveal fairness — encryption (which is reversible with a key)
// is not what this pattern needs or uses. The seed itself is kept
// secret purely by not being transmitted or persisted anywhere the
// client can read it before reveal, not by encrypting it.
//
// THE SCHEME (commit-reveal with player cut)
// -------------------------------------------
//   1. COMMIT  — server generates a secret random seed, deterministically
//                shuffles a fresh 52-card deck from that seed, and
//                publishes only sha256(seed) (the "commitment") before
//                anything is dealt. The seed and shuffled order stay
//                server-side.
//   2. CUT     — the player supplies a cut index (their own contribution
//                of randomness). The server rotates the committed deck
//                by that index and publishes a commitment to the
//                POST-CUT deck — not the actual card values. Publishing
//                real card order before it's dealt would defeat the
//                scheme.
//   3. REVEAL  — once the hand/game is finished, the server publishes
//                the seed and the real deck order (pre- and post-cut).
//   4. VERIFY  — anyone can recompute sha256(seed), re-run the same
//                deterministic shuffle, apply the same cut index, and
//                confirm the results match what was committed to and
//                what was actually used. A mismatch means the server
//                cheated.
//
// Determinism note: Node's Math.random()/crypto.randomInt() are not
// reproducible from a seed, so they cannot drive the shuffle (a
// verifier must be able to re-derive the exact same permutation from
// the revealed seed alone). Random bytes are instead derived from the
// seed via HMAC-SHA256 in counter mode — a standard deterministic
// random byte generator — driving an unbiased Fisher-Yates shuffle.
// =====================================================================

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/**
 * Canonical unshuffled 52-card deck, rank-major within suit order.
 * @returns {string[]} e.g. ['AS','2S',...,'KC']
 */
function freshDeck() {
  const deck = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

/**
 * The one place actual non-deterministic randomness enters the system.
 * Everything downstream of this seed is a deterministic, publicly
 * reproducible function of it.
 * @returns {string} 32 bytes of CSPRNG output, hex-encoded (64 hex chars)
 */
function generateSeed() {
  return crypto.randomBytes(32).toString('hex');
}

/** @param {string} input @returns {string} hex-encoded sha256 digest */
function sha256Hex(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * The published commitment for a seed: sha256(seed). Safe to publish
 * before reveal — it reveals nothing about the seed itself.
 * @param {string} seed
 * @returns {string}
 */
function commitFor(seed) {
  return sha256Hex(seed);
}

/**
 * The published commitment for a deck order (used at the CUT step, to
 * commit to the post-cut deck without revealing its actual card order).
 * Consolidated here from what was previously an inline hash computation
 * in routers/game.js — see file header.
 * @param {string[]} deck
 * @returns {string}
 */
function commitForDeck(deck) {
  return sha256Hex(JSON.stringify(deck));
}

/**
 * Deterministic random byte stream derived from `seed`:
 * HMAC-SHA256(seed, counter) for counter = 0, 1, 2, ... concatenated.
 * Given the same seed this always produces the same byte stream, which
 * is exactly the property a provably-fair verifier depends on.
 * @param {string} seed
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
 * Unbiased Fisher-Yates shuffle driven entirely by the seeded byte
 * stream, so it is fully reproducible from `seed` alone. Uses rejection
 * sampling to avoid modulo bias when mapping a uint32 onto a range.
 * @param {string[]} deck
 * @param {string} seed
 * @returns {string[]}
 */
function seededShuffle(deck, seed) {
  const cards = deck.slice();
  const stream = makeSeededByteStream(seed);

  for (let i = cards.length - 1; i > 0; i -= 1) {
    const range = i + 1;
    const limit = Math.floor(0xffffffff / range) * range;
    let rand = stream.nextUint32();
    while (rand >= limit) rand = stream.nextUint32();
    const j = rand % range;

    [cards[i], cards[j]] = [cards[j], cards[i]];
  }

  return cards;
}

/**
 * Rotates a deck by `cutIndex` cards (the player's contributed
 * randomness). Negative/out-of-range indices are normalized modulo the
 * deck length.
 * @param {string[]} deck
 * @param {number} cutIndex
 * @returns {string[]}
 */
function cutDeck(deck, cutIndex) {
  const n = deck.length;
  const idx = ((cutIndex % n) + n) % n;
  return deck.slice(idx).concat(deck.slice(0, idx));
}

/**
 * Deterministically derives the full pre-cut deck order from a seed
 * alone. Called both by the server at commit time and by any verifier
 * at reveal time — same seed in, same 52-card order out, always.
 * @param {string} seed
 * @returns {string[]}
 */
function deckFromSeed(seed) {
  return seededShuffle(freshDeck(), seed);
}

/**
 * Full independent verification. Recomputes everything from the
 * revealed seed and reports whether each published commitment matches.
 * Never trusts a stored "verified" flag — always recomputes.
 *
 * @param {Object} args
 * @param {string} args.seed - the revealed seed
 * @param {string} args.commit - the commitment published at COMMIT time (sha256(seed))
 * @param {number} args.cutIndex - the cut index applied at CUT time
 * @param {string[]} args.deckAfterCut - the deck order actually used, as revealed
 * @param {string} [args.deckAfterCutCommit] - optional: the commitment published
 *   at CUT time (commitForDeck of the post-cut deck). If provided, this is also
 *   independently re-verified against the recomputed post-cut deck.
 * @returns {{
 *   verified: boolean,
 *   commitMatches: boolean,
 *   deckMatches: boolean,
 *   deckAfterCutCommitMatches: (boolean|null),
 *   recomputedCommit: string,
 *   recomputedDeckOriginal: string[],
 *   recomputedDeckAfterCut: string[],
 *   recomputedDeckAfterCutCommit: string,
 * }}
 */
function verify({ seed, commit, cutIndex, deckAfterCut, deckAfterCutCommit }) {
  const recomputedCommit = commitFor(seed);
  const commitMatches = recomputedCommit === commit;

  const recomputedDeckOriginal = deckFromSeed(seed);
  const recomputedDeckAfterCut = cutDeck(recomputedDeckOriginal, cutIndex);
  const recomputedDeckAfterCutCommit = commitForDeck(recomputedDeckAfterCut);

  const deckMatches =
    Array.isArray(deckAfterCut) &&
    deckAfterCut.length === recomputedDeckAfterCut.length &&
    deckAfterCut.every((card, i) => card === recomputedDeckAfterCut[i]);

  const deckAfterCutCommitMatches =
    deckAfterCutCommit === undefined
      ? null
      : recomputedDeckAfterCutCommit === deckAfterCutCommit;

  return {
    verified:
      commitMatches && deckMatches && deckAfterCutCommitMatches !== false,
    commitMatches,
    deckMatches,
    deckAfterCutCommitMatches,
    recomputedCommit,
    recomputedDeckOriginal,
    recomputedDeckAfterCut,
    recomputedDeckAfterCutCommit,
  };
}

module.exports = {
  // deck construction
  freshDeck,
  // commit phase
  generateSeed,
  commitFor,
  deckFromSeed,
  // cut phase
  cutDeck,
  commitForDeck,
  // verify phase
  verify,
};
