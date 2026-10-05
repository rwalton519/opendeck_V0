/* eslint-disable camelcase */

exports.shorthands = undefined;

// Mirrors models/demo_hand_history.js.
//
// Deliberately a SEPARATE table from `hand_history` (see
// 1745000300000_cashgame-and-hands.js), not a reuse of it: that table's
// `table_id` is an integer FK into `cash_game_tables` (real-money tables),
// and its `raw` column is the real settlement engine's event shape. The
// unauthenticated demo tables (/cashgame-demo, /heads-up -
// services/demo/createDemoRoom.js) have no `cash_game_tables` row and a
// different, simpler payload (see room.buildHandHistoryEntry). Keeping
// these separate means a demo hand can never be mistaken for a real-money
// hand in any export/compliance/audit query against `hand_history`.
//
// `room_key` ('cashgame-demo' | 'heads-up' | future demo variants) is what
// makes this ONE shared table across every demo room rather than one table
// per room - this is what requirement #5 ("feed into one hand history
// database as the other tabs") means in practice: same table, filtered by
// room_key, not a per-room table.
exports.up = (pgm) => {
  pgm.createTable('demo_hand_history', {
    id: 'id',
    room_key: { type: 'varchar(64)', notNull: true },
    hand_number: { type: 'integer', notNull: true },
    payload: { type: 'jsonb', notNull: true },
    created_at: { type: 'timestamp', notNull: false, default: pgm.func('now()') },
  });
  pgm.createIndex('demo_hand_history', 'room_key');
  pgm.createIndex('demo_hand_history', ['room_key', 'id']);
};

exports.down = (pgm) => {
  pgm.dropTable('demo_hand_history');
};
