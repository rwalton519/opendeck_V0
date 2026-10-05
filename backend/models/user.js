const { DataTypes } = require('sequelize');
const sequelize = require('../db/sequelize');

// Converted from models/user.py:
//
//   class User(Base):
//       __tablename__ = "users"
//       id = Column(Integer, primary_key=True, index=True)
//       email = Column(String, unique=True, index=True, nullable=False)
//       username = Column(String, unique=True, index=True, nullable=False)
//       password = Column(String, nullable=False)

const User = sequelize.define(
  'User',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    username: { type: DataTypes.STRING, allowNull: false, unique: true },
    password: { type: DataTypes.STRING, allowNull: false },
    // ADDED: backs the fix to POST /admin/freeze_user and /admin/unfreeze_user
    // (see services/compliance/complianceManager.js). services/game/wsAuth.js
    // already had a defensive check for this field before it existed on the
    // model - see migrations/1745000500000_user-account-controls.js.
    is_frozen: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    // ADDED: powers the Admin Dashboard's accounts table (see
    // admin/adminDashboardRouter.js). Nothing captured a client IP anywhere
    // in this codebase before now - see
    // migrations/1745000700000_admin-dashboard.js's header comment.
    signup_ip: { type: DataTypes.STRING(64), allowNull: true },
    last_login_ip: { type: DataTypes.STRING(64), allowNull: true },
    last_login_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    tableName: 'users',
    timestamps: false,
    indexes: [{ fields: ['email'] }, { fields: ['username'] }],
  }
);

module.exports = User;
