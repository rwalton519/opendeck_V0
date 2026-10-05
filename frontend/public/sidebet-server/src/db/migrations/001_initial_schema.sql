-- SideBet initial production schema. Kept as a versioned migration rather
-- than a schema sync so each deployment is reproducible and reviewable.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  balance NUMERIC(14,2) NOT NULL DEFAULT 1000 CHECK (balance >= 0),
  locked_balance NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (locked_balance >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  odds TEXT NOT NULL DEFAULT '1:1',
  stake NUMERIC(14,2) NOT NULL CHECK (stake > 0),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','MATCHED','DISPUTED','SETTLED','CANCELLED')),
  creator_id UUID NOT NULL REFERENCES users(id),
  opponent_id UUID REFERENCES users(id),
  creator_result UUID REFERENCES users(id),
  opponent_result UUID REFERENCES users(id),
  winner_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  matched_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  CHECK (opponent_id IS NULL OR opponent_id <> creator_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  prediction_id UUID REFERENCES predictions(id),
  amount NUMERIC(14,2) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('LOCK','RELEASE','PAYOUT')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_predictions_status ON predictions(status);
CREATE INDEX IF NOT EXISTS idx_predictions_creator ON predictions(creator_id);
CREATE INDEX IF NOT EXISTS idx_predictions_opponent ON predictions(opponent_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_prediction ON transactions(prediction_id);
