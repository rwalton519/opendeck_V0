const { DataTypes } = require('sequelize');
const sequelize = require('../db/sequelize');

/**
 * One row per user who has linked a self-custody wallet address for
 * on-chain USDC play. A user proves ownership of the address by signing a
 * challenge message with it (see routers/walletOnchain.js's /link) - this
 * table only ever stores the address, never a private key (the backend
 * never has custody of a player's wallet, only of its own operator key -
 * see services/blockchain/chainConfig.js).
 */
const OnchainWallet = sequelize.define(
  'OnchainWallet',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.STRING, allowNull: false, unique: true },
    address: { type: DataTypes.STRING, allowNull: false, unique: true },
    linked_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { tableName: 'onchain_wallets', timestamps: false }
);

/**
 * Audit trail of every on-chain-adjacent event the backend has recorded:
 * verified rebuy funding, hand-settlement rake sweeps, and net USDC deltas
 * applied to a player's table balance. This is separate from
 * wallet_transactions (the fiat/chip ledger - see services/wallet/ledger.js)
 * because these entries reference a real transaction hash / on-chain hand
 * settlement, not an off-chain balance movement - keeping them apart means
 * an on-chain record can always be independently re-verified against
 * Polygon, while wallet_transactions stays the single source of truth for
 * "what is this user's spendable off-chain balance right now."
 */
const OnchainTransaction = sequelize.define(
  'OnchainTransaction',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.STRING, allowNull: false },
    table_id: { type: DataTypes.INTEGER, allowNull: true },
    // fund_verified | rebuy_credited | rake_settled | withdrawal_unlocked
    type: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.DECIMAL(18, 6), allowNull: false }, // USDC, 6-decimal precision
    tx_hash: { type: DataTypes.STRING, allowNull: true },
    hand_id: { type: DataTypes.STRING, allowNull: true }, // bytes32 hex, for rake_settled rows
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { tableName: 'onchain_transactions', timestamps: false }
);

module.exports = { OnchainWallet, OnchainTransaction };
