# Proprietary shuffle engine — not included in this public version

OpenDeck's provably fair shuffle engine (the commit–reveal protocol: seed generation, the HMAC-SHA256-seeded deterministic shuffle, player cut, and reveal/verify) is proprietary and is the subject of a provisional patent application. Its implementation is **excluded from this public repository**.

What remains in the repo shows how the engine is integrated — the game and tournament services call it through this module boundary, and the API/types around it are intact — but the engine code itself is not published here.

The protocol is described at a high level in the project README. The live product at opendeck.ca runs the full engine.
