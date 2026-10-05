/* eslint-disable camelcase */

exports.shorthands = undefined;

// Mirrors models/real_money.js and models/payment_models.js exactly.
exports.up = (pgm) => {
  pgm.createTable('wallet_balance', {
    id: 'id',
    user_id: { type: 'varchar(255)', notNull: true },
    available: { type: 'numeric(18,2)', notNull: false, default: 0 },
    locked: { type: 'numeric(18,2)', notNull: false, default: 0 },
  });
  pgm.addConstraint('wallet_balance', 'wallet_balance_user_id_key', { unique: 'user_id' });

  pgm.createTable('wallet_transactions', {
    id: 'id',
    user_id: { type: 'varchar(255)', notNull: true },
    amount: { type: 'numeric(18,2)', notNull: true },
    type: { type: 'varchar(255)', notNull: true }, // deposit, withdrawal, buyin, payout
    created_at: { type: 'timestamp', notNull: false },
    reference: { type: 'varchar(255)', notNull: false },
  });
  pgm.createIndex('wallet_transactions', 'user_id');

  pgm.createTable('payment_methods', {
    id: 'id',
    user_id: { type: 'varchar(255)', notNull: true },
    provider: { type: 'varchar(255)', notNull: false }, // stripe, ach, wire, crypto
    details: { type: 'varchar(255)', notNull: false }, // tokenized card, bank id, wallet address
    active: { type: 'boolean', notNull: false, default: true },
  });
  pgm.createIndex('payment_methods', 'user_id');

  pgm.createTable('deposit_requests', {
    id: 'id',
    user_id: { type: 'varchar(255)', notNull: true },
    amount: { type: 'numeric(18,2)', notNull: true },
    provider: { type: 'varchar(255)', notNull: false },
    status: { type: 'varchar(255)', notNull: false }, // pending, completed, failed
    created_at: { type: 'timestamp', notNull: false },
  });
  pgm.createIndex('deposit_requests', 'user_id');

  pgm.createTable('withdrawal_requests', {
    id: 'id',
    user_id: { type: 'varchar(255)', notNull: true },
    amount: { type: 'numeric(18,2)', notNull: true },
    provider: { type: 'varchar(255)', notNull: false }, // e.g. "card", "cryptoMonero"
    status: { type: 'varchar(255)', notNull: false }, // pending, approved, rejected, paid
    created_at: { type: 'timestamp', notNull: false },
    destination_address: { type: 'varchar(255)', notNull: false },
    payout_reference: { type: 'varchar(255)', notNull: false },
    failure_reason: { type: 'varchar(255)', notNull: false },
  });
  pgm.createIndex('withdrawal_requests', 'user_id');
  pgm.createIndex('withdrawal_requests', 'status');

  pgm.createType('paymentstatus', ['pending', 'completed', 'failed']);
  pgm.createTable('payment_records', {
    id: 'id',
    user_id: { type: 'varchar(255)', notNull: true },
    provider: { type: 'varchar(255)', notNull: true },
    amount: { type: 'numeric(18,2)', notNull: true },
    status: { type: 'paymentstatus', notNull: false, default: 'pending' },
    external_id: { type: 'varchar(255)', notNull: false },
    created_at: { type: 'timestamp', notNull: false },
    updated_at: { type: 'timestamp', notNull: false },
  });
  pgm.createIndex('payment_records', 'user_id');
};

exports.down = (pgm) => {
  pgm.dropTable('payment_records');
  pgm.dropType('paymentstatus');
  pgm.dropTable('withdrawal_requests');
  pgm.dropTable('deposit_requests');
  pgm.dropTable('payment_methods');
  pgm.dropTable('wallet_transactions');
  pgm.dropTable('wallet_balance');
};
