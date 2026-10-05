import { conflict } from "../utils/AppError.js";

/**
 * All functions here MUST be called with a `client` obtained inside
 * withTransaction() (see src/db/pool.js) — never with the bare pool —
 * so the balance update and its ledger row commit or roll back together.
 *
 * Every function locks the user row with SELECT ... FOR UPDATE before
 * touching balance/locked_balance, so two concurrent requests against the
 * same user (e.g. accepting two markets at once) can't both read a stale
 * balance and both succeed when only one should.
 */

async function lockUserRow(client, userId) {
  const { rows } = await client.query(
    `SELECT id, balance, locked_balance FROM users WHERE id = $1 FOR UPDATE`,
    [userId]
  );
  if (rows.length === 0) throw conflict("User not found.");
  return rows[0];
}

/** Move `amount` from balance into locked_balance and record a LOCK row. */
export async function lockFunds(client, { userId, amount, predictionId }) {
  const user = await lockUserRow(client, userId);
  if (Number(user.balance) < amount) {
    throw conflict("Insufficient balance to cover this stake.");
  }

  await client.query(
    `UPDATE users SET balance = balance - $1, locked_balance = locked_balance + $1 WHERE id = $2`,
    [amount, userId]
  );

  await client.query(
    `INSERT INTO transactions (user_id, prediction_id, amount, type)
     VALUES ($1, $2, $3, 'LOCK')`,
    [userId, predictionId, -amount]
  );
}

/** Release a previously locked amount back to balance (e.g. on cancel). Records a RELEASE row. */
export async function releaseFunds(client, { userId, amount, predictionId }) {
  await lockUserRow(client, userId); // just to take the row lock

  await client.query(
    `UPDATE users SET balance = balance + $1, locked_balance = locked_balance - $1 WHERE id = $2`,
    [amount, userId]
  );

  await client.query(
    `INSERT INTO transactions (user_id, prediction_id, amount, type)
     VALUES ($1, $2, $3, 'RELEASE')`,
    [userId, predictionId, amount]
  );
}

/** Pay `amount` out of a winner's locked_balance into their balance. Records a PAYOUT row. */
export async function payout(client, { userId, amount, predictionId }) {
  await lockUserRow(client, userId);

  await client.query(
    `UPDATE users SET balance = balance + $1, locked_balance = locked_balance - $1 WHERE id = $2`,
    [amount, userId]
  );

  await client.query(
    `INSERT INTO transactions (user_id, prediction_id, amount, type)
     VALUES ($1, $2, $3, 'PAYOUT')`,
    [userId, predictionId, amount]
  );
}

/**
 * Settle a matched, agreed-upon market: the winner's own stake is unlocked
 * and they additionally receive the loser's stake; the loser's stake is
 * unlocked and forfeited (no balance credit). Only one PAYOUT row is
 * written, to the winner, for the full pot — the loser's forfeiture is
 * already on record as their original LOCK row, which simply never
 * reverses. Both user rows are locked (in a fixed id order) before either
 * is updated, to avoid deadlocking against a concurrent settlement that
 * touches the same two users in the opposite order.
 */
export async function settle(client, { winnerId, loserId, stake, predictionId }) {
  const [firstId, secondId] = [winnerId, loserId].sort();
  await lockUserRow(client, firstId);
  await lockUserRow(client, secondId);

  const pot = Math.round(stake * 2 * 100) / 100;

  await client.query(
    `UPDATE users SET balance = balance + $1, locked_balance = locked_balance - $2 WHERE id = $3`,
    [pot, stake, winnerId]
  );
  await client.query(
    `INSERT INTO transactions (user_id, prediction_id, amount, type)
     VALUES ($1, $2, $3, 'PAYOUT')`,
    [winnerId, predictionId, pot]
  );

  await client.query(
    `UPDATE users SET locked_balance = locked_balance - $1 WHERE id = $2`,
    [stake, loserId]
  );
}
