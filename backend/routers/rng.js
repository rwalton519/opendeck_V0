const express = require('express');
const router = express.Router();

const Game = require('../models/game');
const deckService = require('../services/rng/deckService');
const { HttpError } = require('../utils/errors');

// -----------------------------------------------------------------
// FIXED (spec recommendation §7.4 / §12): previously hardcoded mocks
// ('sha256_hash_of_seed', 'seed_value') regardless of input. Now a thin,
// standalone alias onto the same real Game-backed engine used by
// routers/game.js (services/rng/deckService.js) - kept as a separate
// generic /rng/commit + /rng/reveal pair for API compatibility with any
// existing caller of this exact route shape, rather than merged into
// routers/game.js and removed.
// -----------------------------------------------------------------

// GET /rng/commit
router.get('/commit', async (req, res, next) => {
  try {
    const seed = deckService.generateSeed();
    const deckCommit = deckService.commitFor(seed);
    const deckOriginal = deckService.deckFromSeed(seed);

    const game = await Game.create({
      seed,
      deck_commit: deckCommit,
      deck_original: deckOriginal,
    });

    res.json({ game_id: game.id, commit: deckCommit });
  } catch (err) {
    next(err);
  }
});

// GET /rng/reveal/:game_id
router.get('/reveal/:game_id', async (req, res, next) => {
  try {
    const game = await Game.findOne({ where: { id: req.params.game_id } });
    if (!game) throw new HttpError(404, 'Game not found');

    game.revealed = true;
    if (!game.finished_at) game.finished_at = new Date();
    await game.save();

    // `seed` kept as the top-level key for compatibility with the original
    // mock's response shape; deck fields are additive.
    res.json({
      game_id: game.id,
      seed: game.seed,
      deck_commit: game.deck_commit,
      deck_original: game.deck_original,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
