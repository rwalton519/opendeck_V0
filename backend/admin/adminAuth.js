const jwt = require('jsonwebtoken');
// FIXED: was '../config/settings' (chunk1's own config module). Repointed at
// core/config.js so admin tokens are signed with the SAME secret
// services/game/wsAuth.js verifies against - previously an admin token would
// authenticate fine over plain HTTP but silently fail websocket auth if the
// two config modules' SECRET_KEY values ever differed (likely in a fresh
// dev setup, since each module's unset-env-var fallback string is
// different).
const settings = require('../core/config');
const { verifyPassword, hashPassword } = require('../auth/hashing');
const { HttpError } = require('../utils/errors');

// FIXED: was '../services/models/admin', a path that never existed - same
// class of stale reference as serviceAuth.js's User import. chunk2 (the
// core/models/routers chunk) delivered a real Admin model at models/admin.js
// (direct export, not { Admin }) - this admin router literally could not
// boot before this fix (MODULE_NOT_FOUND on require).
const Admin = require('../models/admin');

class AdminAuth {
  static verifyPassword(plain, hashed) {
    return verifyPassword(plain, hashed);
  }

  static hashPassword(password) {
    return hashPassword(password);
  }

  static async authenticate(db, username, password) {
    // FIXED: Sequelize models don't take a db handle as a first argument -
    // same fix as the CashGameTable.findOne() issue flagged in the
    // services-chunk README.
    const admin = await Admin.findOne({ where: { username } });
    if (!admin || !AdminAuth.verifyPassword(password, admin.password_hash)) {
      throw new HttpError(401, 'Invalid admin credentials');
    }
    return AdminAuth.createToken(admin.id);
  }

  static createToken(adminId) {
    const payload = {
      sub: String(adminId),
      role: 'admin',
      // Python: datetime.utcnow() + timedelta(hours=12) -> PyJWT converts a
      // datetime `exp` claim to a Unix timestamp automatically. jsonwebtoken
      // requires the numeric timestamp directly.
      exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    };
    // noTimestamp avoids jsonwebtoken auto-adding an `iat` claim, matching
    // PyJWT's behavior of only encoding exactly what's in the payload dict.
    return jwt.sign(payload, settings.SECRET_KEY, { algorithm: 'HS256', noTimestamp: true });
  }
}

module.exports = AdminAuth;
