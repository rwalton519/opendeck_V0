import pkg from "pg";

const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  // Errors on idle clients (e.g. a connection dropped by the DB) — log,
  // don't crash the process.
  console.error("Unexpected error on idle Postgres client", err);
});

/**
 * Run `fn` inside a single Postgres transaction. `fn` receives a client
 * that MUST be used for every query in the transaction (not the pool),
 * so all statements share the same session and can be rolled back together.
 *
 * Wrapping multi-step money movements (lock funds + write ledger row +
 * update prediction status, etc.) in one transaction is what prevents the
 * "balance changed but the ledger row never landed" failure mode called
 * out in the spec.
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
