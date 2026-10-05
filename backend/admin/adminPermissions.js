const jwt = require('jsonwebtoken');
const settings = require('../core/config');

// FIXED: was '../services/models/admin', a path that never existed - see
// adminAuth.js for the same fix and explanation.
const Admin = require('../models/admin');

/**
 * Mirrors require_admin() from admin_permissions.py. FastAPI's HTTPBearer()
 * dependency extracts the `Authorization: Bearer <token>` header for us;
 * here that's done manually. Note the Python code wraps the *entire* function
 * body (including its own explicit 403 raises for "Admin access required"
 * and "Admin not found") in a bare `except Exception`, which means every
 * failure path - bad token, wrong role, missing admin - all collapse into
 * the same generic 403 "Invalid admin token" response. That quirk is
 * preserved here exactly rather than "fixed".
 */
async function requireAdmin(req, res, next) {
  try {
    const authHeader = req.headers['authorization'] || '';
    if (!authHeader.startsWith('Bearer ')) {
      throw new Error('Missing bearer token');
    }
    const token = authHeader.slice('Bearer '.length);

    const payload = jwt.verify(token, settings.SECRET_KEY, { algorithms: ['HS256'] });

    if (payload.role !== 'admin') {
      throw new Error('Admin access required');
    }

    // FIXED: was `parseInt(payload.sub, 10)` - Admin.id is a UUID (string),
    // not an integer, so parseInt() would silently mangle it into NaN or a
    // truncated garbage number instead of ever matching a real admin row.
    const adminId = payload.sub;
    // FIXED: same Sequelize call-signature issue as adminAuth.js.
    const admin = await Admin.findOne({ where: { id: adminId } });

    if (!admin) {
      throw new Error('Admin not found');
    }

    req.admin = admin;
    next();
  } catch (err) {
    res.status(403).json({ detail: 'Invalid admin token' });
  }
}

module.exports = requireAdmin;
