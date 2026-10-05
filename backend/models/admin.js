const { DataTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const sequelize = require('../db/sequelize');

// Converted from models/admin.py:
//
//   class Admin(Base):
//       __tablename__ = "admins"
//       id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
//       username = Column(String(50), unique=True, nullable=False, index=True)
//       password_hash = Column(String(255), nullable=False)
//
//       def set_password(self, password): self.password_hash = _pwd_context.hash(password)
//       def check_password(self, password): return _pwd_context.verify(password, self.password_hash)
//
// passlib's CryptContext(schemes=["bcrypt"]) -> bcryptjs (see the sibling
// chunk's auth/hashing.js note on salt rounds; same assumption applies here).
const SALT_ROUNDS = 10;

const Admin = sequelize.define(
  'Admin',
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: () => uuidv4() },
    username: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    password_hash: { type: DataTypes.STRING(255), allowNull: false },
  },
  {
    tableName: 'admins',
    timestamps: false,
    indexes: [{ fields: ['username'] }],
  }
);

// Mirrors Admin.set_password(password)
Admin.prototype.setPassword = function setPassword(password) {
  this.password_hash = bcrypt.hashSync(password, SALT_ROUNDS);
};

// Mirrors Admin.check_password(password)
Admin.prototype.checkPassword = function checkPassword(password) {
  return bcrypt.compareSync(password, this.password_hash);
};

// Mirrors Admin.__repr__
Admin.prototype.toString = function toString() {
  return `<Admin ${this.username}>`;
};

module.exports = Admin;
