const jwt = require('jsonwebtoken');

// NOTE: app.core.config.settings - see the sibling chunk's core/config.js.
const settings = require('../../core/config');
// NOTE: app.models.user.User - see the sibling chunk's models/user.js.
const User = require('../../models/user');
// NOTE: app.models.admin.Admin - see the sibling chunk's models/admin.js.
const Admin = require('../../models/admin');

// FLAGGED INTEGRATION MISMATCH: the original Python constructs a fake
// HTTPBearer-credentials object (`type("obj", (object,), {"credentials": token})`)
// just to satisfy require_admin()'s expected parameter shape, then calls it
// as a plain function to get back an Admin object. But the earlier chunk's
// `admin/adminPermissions.js` was converted as EXPRESS MIDDLEWARE - it
// expects (req, res, next) and calls next()/res.status() rather than
// returning a value, so it can't be reused here as-is. Rather than force a
// mismatched shape onto that middleware, this reimplements the same
// token-to-Admin lookup inline (JWT verify -> role check -> Admin lookup),
// mirroring what require_admin() actually does internally.

class WSAuth {
  /**
   * Extracts and validates a JWT from the WebSocket connection's query
   * params. Returns { type: "user"|"admin", user|admin: <obj> }.
   *
   * @param {import('ws').WebSocket} ws
   * @param {*} db
   * @param {import('http').IncomingMessage} request - the upgrade request, used to read query params
   */
  static async authenticate(ws, db, request) {
    const url = new URL(request.url, 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4401);
      throw new Error('Missing token');
    }

    let payload;
    try {
      payload = jwt.verify(token, settings.SECRET_KEY, { algorithms: ['HS256'] });
    } catch (e) {
      ws.close(4401);
      throw new Error('Invalid token');
    }

    const role = payload.role;
    const userId = payload.sub;

    // Admin override
    if (role === 'admin') {
      const admin = await Admin.findOne({ where: { id: userId } });
      if (!admin) {
        ws.close(4401);
        throw new Error('Invalid admin token');
      }
      return { type: 'admin', admin };
    }

    // Standard user
    const user = await User.findOne({ where: { id: userId } });
    if (!user) {
      ws.close(4401);
      throw new Error('User not found');
    }

    // Graceful: is_frozen is not on the current User model; skip if absent
    if (user.is_frozen) {
      ws.close(4403);
      throw new Error('Account frozen');
    }

    return { type: 'user', user };
  }
}

module.exports = WSAuth;
