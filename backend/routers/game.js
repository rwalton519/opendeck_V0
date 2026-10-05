const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const Game = require('../models/game');
const deckService = require('../services/rng/deckService');
const { HttpError } = require('../utils/errors');

// -----------------------------------------------------------------
// FIXED (spec recommendation §7.4 / §12): every handler in this file
// previously returned a hardcoded literal (a fixed 3-card sample deck, a
// fixed seed string) regardless of input, with no persistence and no real
// shuffling, sealing, or verification logic. This is now backed by a real
// commit-reveal provably-fair deck engine - see services/rng/deckService.js
// for the cryptographic design.
//
// Route shapes are kept close to the original mock API for compatibility,
// with one deliberate change: POST /:game_id/cut no longer returns the real
// post-cut card values. Publishing actual card order before a hand is dealt
// would defeat the entire point of a provably-fair scheme - a verifier is
// meant to check the numbers add up AFTER the fact, using the seed revealed
// at /reveal, not be handed the deck in advance. It now returns a
// commitment (hash) to the post-cut deck instead.
//
// SCOPE NOTE: this router provides the cryptographic commit/shuffle/
// cut/reveal/verify primitives and makes them real. It does not, by itself,
// wire card-dealing into live cash-game or tournament hands - that
// integration (per-hand deck draws service-side within
// services/game/settlementManager.js et al.) is a further, separate piece
// of work building on top of this engine, not included in this fix pass.
// -----------------------------------------------------------------

// POST /game/start
router.post('/start', async (req, res, next) => {
  try {
    const seed = deckService.generateSeed();
    const deckCommit = deckService.commitFor(seed);
    const deckOriginal = deckService.deckFromSeed(seed);

    const game = await Game.create({
      user_id: req.body && req.body.user_id ? req.body.user_id : null,
      seed,
      deck_commit: deckCommit,
      deck_original: deckOriginal,
    });

    res.json({
      game_id: game.id,
      deck_commit: deckCommit,
    });
  } catch (err) {
    next(err);
  }
});

// POST /game/:game_id/cut
router.post('/:game_id/cut', async (req, res, next) => {
  try {
    if (!req.body || !('cut_index' in req.body)) {
      throw new HttpError(400, "'cut_index' is required");
    }
    const cutIndex = parseInt(req.body.cut_index, 10);
    if (!Number.isInteger(cutIndex)) {
      throw new HttpError(400, "'cut_index' must be an integer");
    }

    const game = await Game.findOne({ where: { id: req.params.game_id } });
    if (!game) throw new HttpError(404, 'Game not found');
    if (game.cut_index !== null) throw new HttpError(400, 'Game has already been cut');

    const deckAfterCut = deckService.cutDeck(game.deck_original, cutIndex);
    const deckAfterCutCommit = crypto
      .createHash('sha256')
      .update(JSON.stringify(deckAfterCut), 'utf8')
      .digest('hex');

    game.cut_index = cutIndex;
    game.deck_after_cut = deckAfterCut;
    game.deck_after_cut_commit = deckAfterCutCommit;
    await game.save();

    // Deliberately NOT returning deckAfterCut's actual card values here -
    // see the file-level note above. Only a commitment is published now;
    // the real values come out at /reveal.
    res.json({
      game_id: game.id,
      cut_index: cutIndex,
      deck_after_cut_commit: deckAfterCutCommit,
    });
  } catch (err) {
    next(err);
  }
});

// POST /game/:game_id/reveal
router.post('/:game_id/reveal', async (req, res, next) => {
  try {
    const game = await Game.findOne({ where: { id: req.params.game_id } });
    if (!game) throw new HttpError(404, 'Game not found');
    if (game.cut_index === null) {
      throw new HttpError(400, 'Game must be cut before it can be revealed');
    }

    if (!game.finished_at) {
      game.finished_at = new Date();
    }
    game.revealed = true;
    await game.save();

    res.json({
      game_id: game.id,
      seed: game.seed,
      deck_original: game.deck_original,
      deck_after_cut: game.deck_after_cut,
    });
  } catch (err) {
    next(err);
  }
});

// GET /game/:game_id/verify
router.get('/:game_id/verify', async (req, res, next) => {
  try {
    const game = await Game.findOne({ where: { id: req.params.game_id } });
    if (!game) throw new HttpError(404, 'Game not found');
    if (!game.revealed) {
      throw new HttpError(400, 'Game has not been revealed yet - nothing to verify against');
    }

    // Always recompute from scratch rather than trusting the stored
    // `verified` column - that column is just a cache of the last check.
    const result = deckService.verify({
      seed: game.seed,
      commit: game.deck_commit,
      cutIndex: game.cut_index,
      deckAfterCut: game.deck_after_cut,
    });

    game.verified = result.verified;
    await game.save();

    res.json({
      game_id: game.id,
      verified: result.verified,
      commit_matches: result.commitMatches,
      deck_matches: result.deckMatches,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
