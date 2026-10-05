// NOTE: app.models.collusion_flag.CollusionFlag - see the sibling chunk's
// models/collusion_flag.js (Sequelize model).
const CollusionFlag = require('../../models/collusion_flag');

class CollusionEngine {
  /**
   * hand = {
   *   table_id: 12,
   *   hand_id: "12345",
   *   pots: [...],
   *   results: {...}
   * }
   */
  static async analyzeHand(db, hand) {
    const flags = [];

    const results = hand.results || {};
    const tableId = hand.table_id;
    const handId = hand.hand_id;

    // -----------------------------------------
    // 1. CHIP DUMPING DETECTION
    // -----------------------------------------
    const absSum = Object.values(results).reduce((sum, x) => sum + Math.abs(x), 0);
    for (const [player, delta] of Object.entries(results)) {
      if (delta < -0.4 * absSum) {
        // One player lost a huge % of chips in one hand
        flags.push({
          type: 'chip_dump',
          severity: 7,
          players: [player],
          details: { delta },
        });
      }
    }

    // -----------------------------------------
    // 2. SOFT PLAY DETECTION
    // -----------------------------------------
    // If two players never bet against each other but bet against others
    // (requires more advanced tracking later)
    // Placeholder simple rule:
    const entries = Object.entries(results);
    if (entries.length >= 3) {
      const losers = entries.filter(([, d]) => d < 0).map(([p]) => p);
      const winners = entries.filter(([, d]) => d > 0).map(([p]) => p);

      if (winners.length === 1 && losers.length >= 2) {
        flags.push({
          type: 'soft_play',
          severity: 5,
          players: [...losers, ...winners],
          details: { winners, losers },
        });
      }
    }

    // -----------------------------------------
    // 3. MULTI-ACCOUNTING (IP/device correlation)
    // -----------------------------------------
    // Placeholder - real version uses login logs
    // We'll add this later in the advanced module.

    // -----------------------------------------
    // SAVE FLAGS
    // -----------------------------------------
    for (const f of flags) {
      await CollusionFlag.create({
        user_ids: f.players,
        table_id: tableId,
        hand_id: handId,
        flag_type: f.type,
        severity: f.severity,
        details: f.details,
      });
    }

    return flags;
  }
}

module.exports = CollusionEngine;
