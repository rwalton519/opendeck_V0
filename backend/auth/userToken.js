const jwt = require('jsonwebtoken');

// IMPORTANT: this must be core/config.js (chunk2), NOT config/settings.js
// (chunk1) - services/game/wsAuth.js verifies tokens against core/config.js's
// SECRET_KEY, so a user token signed with the wrong config module would
// authenticate fine over plain HTTP but silently fail websocket auth (a
// mismatched-secret failure, not an expired/malformed-token failure - easy
// to miss). See admin/adminAuth.js and admin/adminPermissions.js for the
// matching fix on the admin side.
const settings = require('../core/config');

const TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * Signs a JWT for a regular (non-admin) user. Payload shape matches what
 * wsAuth.js expects: `sub` = user id, `role` absent/non-"admin" so it's
 * routed down the regular-user path rather than the admin path.
 */
function createUserToken(user) {
  const payload = {
    sub: String(user.id),
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  return jwt.sign(payload, settings.SECRET_KEY, { algorithm: settings.JWT_ALGORITHM, noTimestamp: true });
}

module.exports = { createUserToken };
