/* eslint-disable camelcase */

exports.shorthands = undefined;

// ADDED as part of the fix for POST /admin/freeze_user and
// /admin/unfreeze_user, which previously called ComplianceManager methods
// that didn't exist. services/game/wsAuth.js already defensively checked
// for a `user.is_frozen` field ("not on the current User model; skip if
// absent") - this migration, together with the models/user.js update in the
// same change, is what makes that check meaningful instead of a permanent
// no-op.
exports.up = (pgm) => {
  pgm.addColumns('users', {
    is_frozen: { type: 'boolean', notNull: false, default: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('users', ['is_frozen']);
};
