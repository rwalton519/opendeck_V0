const { hashPassword, verifyPassword } = require('./hashing');
const { HttpError } = require('../utils/errors');

// FIXED: originally pointed at '../services/models/user', a path that never
// existed - it was written before the real User model (chunk2,
// models/user.js) existed. Now points at the real Sequelize model.
const User = require('../models/user');

/**
 * Mirrors:
 *   def create_user(db: Session, data: UserCreate) -> UserOut:
 *       user = User(email=data.email, username=data.username, password=hash_password(data.password))
 *       db.add(user); db.commit(); db.refresh(user)
 *       return user
 */
async function createUser(db, data) {
  const existing = await User.findOne({ where: { email: data.email } });
  if (existing) {
    throw new HttpError(409, 'Email already registered');
  }

  // FIXED: only `email` uniqueness was pre-checked here, even though
  // `username` is also unique at the model/DB level (see models/user.js).
  // A duplicate username fell through to User.create(), which threw a raw
  // SequelizeUniqueConstraintError - caught by routerAuth.js's generic
  // `catch` and surfaced to the client as `{"detail":"Validation error"}`
  // (400), with no indication of which field was actually the problem.
  // Pre-checking here mirrors the email check above and gives a clean,
  // actionable 409 instead.
  const existingUsername = await User.findOne({ where: { username: data.username } });
  if (existingUsername) {
    throw new HttpError(409, 'Username already taken');
  }

  const user = await User.create({
    email: data.email,
    username: data.username,
    password: hashPassword(data.password), // column is named `password` but always holds a bcrypt hash
    // ADDED: see migrations/1745000700000_admin-dashboard.js - powers the
    // Admin Dashboard's accounts table. `data.ip` is optional (undefined
    // just leaves the column null) so this never breaks non-HTTP callers.
    signup_ip: data.ip || null,
  });

  return user;
}

/**
 * Real login check: look up by email, bcrypt-compare the password.
 * Throws HttpError(401) on any failure - deliberately the same message for
 * "no such user" and "wrong password" so login can't be used to enumerate
 * registered emails.
 */
async function loginUser(db, email, password, ip) {
  const user = await User.findOne({ where: { email } });

  if (!user || !verifyPassword(password, user.password)) {
    throw new HttpError(401, 'Incorrect email or password');
  }

  // ADDED: see migrations/1745000700000_admin-dashboard.js. Best-effort -
  // a failure here shouldn't block a successful login, so it's not awaited
  // as part of the auth decision above.
  if (ip) {
    user.last_login_ip = ip;
    user.last_login_at = new Date();
    await user.save();
  }

  return user;
}

module.exports = { createUser, loginUser };
