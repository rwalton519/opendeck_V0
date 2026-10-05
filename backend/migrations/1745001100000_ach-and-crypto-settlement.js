/* eslint-disable camelcase */
// Adds durable state for asynchronous blockchain monitoring.  PaymentMethod
// already stores tokenized ACH/Financial Connections references, so no bank
// credentials are added to this schema.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('crypto_deposits', {
    id: 'id',
    user_id: { type: 'varchar(255)', notNull: true },
    asset: { type: 'varchar(16)', notNull: true },
    address: { type: 'varchar(255)', notNull: true },
    txid: { type: 'varchar(255)', notNull: false, unique: true },
    amount: { type: 'numeric(36,18)', notNull: false },
    confirmations: { type: 'integer', notNull: true, default: 0 },
    status: { type: 'varchar(32)', notNull: true, default: 'watching' },
    credited_at: { type: 'timestamp', notNull: false },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('crypto_deposits', ['user_id', 'asset', 'status']);
  pgm.createIndex('crypto_deposits', 'address');
};

exports.down = (pgm) => pgm.dropTable('crypto_deposits');
