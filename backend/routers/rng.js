'use strict';

// =====================================================================
// PUBLIC VERSION STUB — proprietary shuffle engine excluded
// =====================================================================
//
// The /rng endpoints expose OpenDeck's proprietary provably fair
// commit–reveal shuffle engine (subject of a provisional patent
// application), so the real router is not included in this public
// repository. This stub keeps the mount in server.js working and
// answers every route with 501 and an explanation. The live product
// at opendeck.ca runs the full engine. See
// backend/services/rng/README.md.

const express = require('express');

const router = express.Router();

router.use((req, res) => {
  res.status(501).json({
    detail:
      'The provably fair RNG endpoints are part of OpenDeck\'s proprietary ' +
      'shuffle engine and are excluded from this public repository.',
  });
});

module.exports = router;
