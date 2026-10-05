/* eslint-disable camelcase */

exports.shorthands = undefined;

// Mirrors models/onchain_wallet.js exactly.
exports.up = (pgm) => {
  pgm.createTable('onchain_wallets', {
    id: 'id',
    user_id: { type: 'varchar(255)', notNull: true },
    address: { type: 'varchar(255)', notNull: true },
    linked_at: { type: 'timestamp', notNull: false, default: pgm.func('now()') },
  });
  pgm.addConstraint('onchain_wallets', 'onchain_wallets_user_id_key', { unique: 'user_id' });
  pgm.addConstraint('onchain_wallets', 'onchain_wallets_address_key', { unique: 'address' });

  pgm.createTable('onchain_transactions', {
    id: 'id',
    user_id: { type: 'varchar(255)', notNull: true },
    table_id: { type: 'integer', notNull: false },
    type: { type: 'varchar(64)', notNull: true }, // fund_verified | rebuy_credited | rake_settled | withdrawal_unlocked
    amount: { type: 'numeric(18,6)', notNull: true },
    tx_hash: { type: 'varchar(255)', notNull: false },
    hand_id: { type: 'varchar(255)', notNull: false },
    created_at: { type: 'timestamp', notNull: false, default: pgm.func('now()') },
  });
  pgm.createIndex('onchain_transactions', 'user_id');
  pgm.createIndex('onchain_transactions', 'tx_hash');
};

exports.down = (pgm) => {
  pgm.dropTable('onchain_transactions');
  pgm.dropTable('onchain_wallets');
};
