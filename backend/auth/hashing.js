const bcrypt = require('bcryptjs');

// Python used passlib's CryptContext(schemes=["bcrypt"], deprecated="auto"),
// which just wraps standard bcrypt hashing/verification (with automatic
// rehash-on-verify for deprecated schemes - not applicable here since bcrypt
// is the only scheme). bcryptjs produces/consumes the same $2a$/$2b$ hash
// format, so existing password hashes remain valid.
const SALT_ROUNDS = 10; // passlib's bcrypt default is also a cost factor of 12 in
// recent versions; adjust here if your original deployment used a different
// rounds value. This is an assumption since the exact configured rounds
// weren't specified in the supplied hashing.py.

function hashPassword(password) {
  return bcrypt.hashSync(password, SALT_ROUNDS);
}

function verifyPassword(password, hashed) {
  return bcrypt.compareSync(password, hashed);
}

module.exports = { hashPassword, verifyPassword };
