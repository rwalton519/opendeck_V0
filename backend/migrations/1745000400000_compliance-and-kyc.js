/* eslint-disable camelcase */

exports.shorthands = undefined;

// Mirrors models/compliance_models.js, models/collusion_flag.js, and
// models/kyc_models.js. Note KYCState here is intentionally a separate,
// independent enum from models/real_money.js's KYCStatus - both are kept as
// distinct in the model layer (see the comment in real_money.js), so this
// migration preserves that rather than unifying them.
exports.up = (pgm) => {
  pgm.createTable('compliance_flags', {
    id: 'id',
    user_id: { type: 'varchar(255)', notNull: true },
    rule: { type: 'varchar(255)', notNull: true },
    message: { type: 'varchar(255)', notNull: true },
    created_at: { type: 'timestamp', notNull: false },
    resolved: { type: 'boolean', notNull: false, default: false },
  });
  pgm.createIndex('compliance_flags', 'user_id');

  pgm.createTable('collusion_flags', {
    id: 'id',
    user_ids: { type: 'jsonb', notNull: false },
    table_id: { type: 'integer', notNull: false },
    hand_id: { type: 'varchar(255)', notNull: false },
    flag_type: { type: 'varchar(255)', notNull: false }, // e.g. "soft_play", "chip_dump", "shared_cards"
    severity: { type: 'integer', notNull: false }, // 1-10
    details: { type: 'jsonb', notNull: false },
    resolved: { type: 'boolean', notNull: false, default: false },
    created_at: { type: 'timestamp', notNull: false },
  });
  pgm.createIndex('collusion_flags', 'table_id');
  pgm.createIndex('collusion_flags', 'hand_id');

  pgm.createType('kycstate', ['unverified', 'pending', 'verified', 'rejected']);
  pgm.createTable('kyc_records', {
    id: 'id',
    user_id: { type: 'varchar(255)', notNull: true },
    provider: { type: 'varchar(255)', notNull: false },
    state: { type: 'kycstate', notNull: false, default: 'unverified' },
    external_id: { type: 'varchar(255)', notNull: false },
    updated_at: { type: 'timestamp', notNull: false },
  });
  pgm.addConstraint('kyc_records', 'kyc_records_user_id_key', { unique: 'user_id' });
};

exports.down = (pgm) => {
  pgm.dropTable('kyc_records');
  pgm.dropType('kycstate');
  pgm.dropTable('collusion_flags');
  pgm.dropTable('compliance_flags');
};
