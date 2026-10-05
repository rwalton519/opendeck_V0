-- Defence in depth for the lifecycle code. Application transactions and row
-- locks remain primary concurrency control; these constraints ensure a
-- duplicate lock/payout cannot become durable after a retry or regression.
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_one_lock_per_user_market
  ON transactions (user_id, prediction_id) WHERE type = 'LOCK';

CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_one_payout_per_market
  ON transactions (prediction_id) WHERE type = 'PAYOUT';

ALTER TABLE predictions
  ADD CONSTRAINT predictions_settlement_shape CHECK (
    (status = 'SETTLED') = (winner_id IS NOT NULL AND settled_at IS NOT NULL)
  ) NOT VALID;

-- Historic prototype rows may violate the new shape. They are not silently
-- accepted as valid: review/remediate them, then run
-- ALTER TABLE predictions VALIDATE CONSTRAINT predictions_settlement_shape.
