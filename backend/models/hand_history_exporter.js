// Converted from models/hand_history_exporter.py's HandHistoryExporter class.
// This is pure formatting logic with no DB/framework dependency, so it
// translates 1:1 with no assumptions required.

class HandHistoryExporter {
  /**
   * Convert raw hand data into PokerStars-style text.
   */
  static toPokerstarsFormat(hand) {
    const lines = [];
    lines.push(`PokerStars Hand #${hand.hand_id}:  Hold'em No Limit`);
    lines.push(`Table ${hand.table_id}`);

    lines.push('*** SUMMARY ***');

    // Pots
    for (const pot of hand.pots || []) {
      lines.push(`Total pot ${pot.amount} | Rake 0`);
    }

    // Results
    lines.push('*** RESULTS ***');
    const results = hand.results || {};
    for (const [player, delta] of Object.entries(results)) {
      if (delta > 0) {
        lines.push(`Seat ${player}: collected ${delta}`);
      } else {
        lines.push(`Seat ${player}: lost ${Math.abs(delta)}`);
      }
    }

    return lines.join('\n');
  }
}

module.exports = HandHistoryExporter;
