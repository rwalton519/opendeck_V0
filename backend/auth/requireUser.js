const jwt = require('jsonwebtoken');
const settings = require('../core/config');
const User = require('../models/user');
const { HttpError } = require('../utils/errors');

/**
 * Authenticates a normal OpenDeck user from the Authorization: Bearer <JWT>
 * header. The identity is always taken from the signed token; callers must
 * never be allowed to choose another user by posting user_id in JSON.
 */
async function requireUser(req, res, next) {
  try {
    const header = req.get('authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) throw new HttpError(401, 'Authentication required');

    let payload;
    try {
      payload = jwt.verify(match[1], settings.SECRET_KEY, { algorithms: ['HS256'] });
    } catch {
      throw new HttpError(401, 'Invalid or expired authentication token');
    }

    if (payload.role === 'admin' || !payload.sub) {
      throw new HttpError(401, 'A regular user account is required');
    }

    const user = await User.findByPk(payload.sub);
    if (!user) throw new HttpError(401, 'User account not found');
    if (user.is_frozen) throw new HttpError(403, 'Account is frozen');

    req.user = user;
    next();
  } catch (err) {
    next(err.statusCode ? err : new HttpError(401, err.message || 'Authentication required'));
  }
}

async function optionalUser(req, res, next) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return next();

  try {
    const payload = jwt.verify(match[1], settings.SECRET_KEY, { algorithms: ['HS256'] });
    if (payload.role === 'admin' || !payload.sub) return next();
    const user = await User.findByPk(payload.sub);
    if (user && !user.is_frozen) req.user = user;
    next();
  } catch {
    next();
  }
}

module.exports = { requireUser, optionalUser };
