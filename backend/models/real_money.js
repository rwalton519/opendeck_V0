const { DataTypes } = require('sequelize');
const sequelize = require('../db/sequelize');

// Converted from models/real_money.py's KYCStatus enum (note: distinct from,
// and seemingly redundant with, models/kyc_models.py's KYCState - both were
// defined separately in the Python source, preserved as separate exports here).
const KYCStatus = Object.freeze({
  unverified: 'unverified',
  pending: 'pending',
  verified: 'verified',
  rejected: 'rejected',
});

const WalletBalance = sequelize.define(
  'WalletBalance',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.STRING, allowNull: false, unique: true },
    available: { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
    locked: { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  },
  { tableName: 'wallet_balance', timestamps: false }
);

const WalletTransaction = sequelize.define(
  'WalletTransaction',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.DECIMAL(18, 2), allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false }, // deposit, withdrawal, buyin, payout
    created_at: { type: DataTypes.DATE, allowNull: true },
    reference: { type: DataTypes.STRING, allowNull: true },
  },
  { tableName: 'wallet_transactions', timestamps: false }
);

const PaymentMethod = sequelize.define(
  'PaymentMethod',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.STRING, allowNull: false },
    provider: { type: DataTypes.STRING, allowNull: true }, // stripe, ach, wire, crypto
    details: { type: DataTypes.STRING, allowNull: true }, // tokenized card, bank id, wallet address
    active: { type: DataTypes.BOOLEAN, defaultValue: true },
  },
  { tableName: 'payment_methods', timestamps: false }
);

const DepositRequest = sequelize.define(
  'DepositRequest',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.DECIMAL(18, 2), allowNull: false },
    provider: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: true }, // pending, completed, failed
    created_at: { type: DataTypes.DATE, allowNull: true },
  },
  { tableName: 'deposit_requests', timestamps: false }
);

const WithdrawalRequest = sequelize.define(
  'WithdrawalRequest',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.DECIMAL(18, 2), allowNull: false },
    provider: { type: DataTypes.STRING, allowNull: true }, // stores the specific method, e.g. "card", "cryptoMonero"
    status: { type: DataTypes.STRING, allowNull: true }, // pending, approved, rejected, paid
    created_at: { type: DataTypes.DATE, allowNull: true },
    // ADDED: needed to actually send a real crypto payout - there was
    // nowhere to collect where the funds should go. Required for crypto
    // methods, unused for card/ACH (those pay out to whatever's on file
    // with the payment processor instead of a per-withdrawal address).
    destination_address: { type: DataTypes.STRING, allowNull: true },
    // ADDED: the real-world reference for a completed payout (a Stripe
    // transfer id or a Monero transaction hash) - previously nothing
    // recorded what actually happened once a withdrawal was "approved",
    // because nothing actually triggered a real transfer.
    payout_reference: { type: DataTypes.STRING, allowNull: true },
    // ADDED: if a real payout attempt fails (e.g. Stripe Connect account
    // not onboarded, RPC error), this records why - so a withdrawal that's
    // still "pending" because of a failed attempt is distinguishable from
    // one nobody has looked at yet.
    failure_reason: { type: DataTypes.STRING, allowNull: true },
  },
  { tableName: 'withdrawal_requests', timestamps: false }
);

// ComplianceFlag lives in compliance_models.js (canonical) - not redefined
// here, matching the Python source's comment about avoiding a duplicate
// mapper conflict on the shared "compliance_flags" table name.

module.exports = {
  KYCStatus,
  WalletBalance,
  WalletTransaction,
  PaymentMethod,
  DepositRequest,
  WithdrawalRequest,
};
