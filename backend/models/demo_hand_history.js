const { DataTypes } = require('sequelize');
const sequelize = require('../db/sequelize');

// Persistent, permanent ledger for the unauthenticated demo tables
// (/cashgame-demo, /heads-up - see services/demo/createDemoRoom.js).
//
// This is intentionally NOT the same table as models/hand_history.js (the
// real-money settlement ledger) - see the migration's header comment
// (1745000900000_demo-hand-history.js) for why. `room_key` is the column
// that makes this one shared table serve every demo room: cashgame-demo
// and heads-up both write here, distinguished only by room_key, so a
// single query (or a single UI, if ever needed) can show the combined
// history across every demo table.
//
// Unlike the in-memory room state (which is deliberately ephemeral - a
// server restart resets seats/current-hand by design, see
// createDemoRoom.js), this table is the actual persistent record: it's
// what makes the Hand History panel a permanent fixture / historical
// record (requirement) rather than a session-scoped log.
const DemoHandHistory = sequelize.define(
  'DemoHandHistory',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    room_key: { type: DataTypes.STRING, allowNull: false },
    hand_number: { type: DataTypes.INTEGER, allowNull: false },
    payload: { type: DataTypes.JSONB, allowNull: false },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: 'demo_hand_history',
    timestamps: false,
    indexes: [{ fields: ['room_key'] }, { fields: ['room_key', 'id'] }],
  }
);

module.exports = DemoHandHistory;
