'use strict';

// =====================================================================
// PUBLIC VERSION STUB — proprietary shuffle engine excluded
// =====================================================================
//
// OpenDeck's provably fair commit–reveal shuffle engine is proprietary
// and the subject of a provisional patent application, so its
// implementation is NOT included in this public repository (see
// backend/services/rng/README.md). This stub keeps the module's public
// surface so the rest of the codebase loads and the server boots;
// the generic deck helpers (freshDeck, cutDeck) work as before, while
// every function that belongs to the commit–reveal protocol throws a
// clear error if called. The live product at opendeck.ca runs the
// full engine.

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['S', 'H', 'D', 'C'];

function excludedError(fnName) {
  return new Error(
    `deckService.${fnName} is part of OpenDeck's proprietary provably fair ` +
    'shuffle engine and is excluded from this public repository. ' +
    'See backend/services/rng/README.md.'
  );
}

// Canonical ordered 52-card deck (rank+suit strings, e.g. "AS", "10H").
function freshDeck() {
  const deck = [];
  for (const rank of RANKS) for (const suit of SUITS) deck.push(`${rank}${suit}`);
  return deck;
}

// Plain deck rotation at the cut index — a generic card operation.
function cutDeck(deck, cutIndex) {
  const n = deck.length;
  const i = ((cutIndex % n) + n) % n;
  return deck.slice(i).concat(deck.slice(0, i));
}

function generateSeed() { throw excludedError('generateSeed'); }
function commitFor() { throw excludedError('commitFor'); }
function deckFromSeed() { throw excludedError('deckFromSeed'); }
function verify() { throw excludedError('verify'); }

module.exports = {
  freshDeck,
  generateSeed,
  commitFor,
  deckFromSeed,
  cutDeck,
  verify,
};
