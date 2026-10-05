import { Router } from "express";
import { pool, withTransaction } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { lockFunds, releaseFunds, settle } from "../services/ledger.js";
import {
  requireNonEmptyString,
  requirePositiveAmount,
  requireUuid,
  isUuid,
} from "../utils/validate.js";
import { badRequest, forbidden, notFound, conflict } from "../utils/AppError.js";

const router = Router();

const PREDICTION_WITH_EMAILS_SQL = `
  SELECT p.*, c.email AS creator_email, o.email AS opponent_email
  FROM predictions p
  JOIN users c ON c.id = p.creator_id
  LEFT JOIN users o ON o.id = p.opponent_id
  WHERE p.id = $1
`;

/**
 * Re-reads a prediction joined with creator/opponent emails, using the
 * given client (so inside a transaction this sees the just-written,
 * not-yet-committed row). Every route returns this shape so the frontend
 * never has to special-case "response from POST" vs "response from GET".
 */
async function fetchWithEmails(client, id) {
  const { rows } = await client.query(PREDICTION_WITH_EMAILS_SQL, [id]);
  return rows[0];
}

// ---------------------------------------------------------------------------
// POST /predictions — open a new market. Locks the creator's stake.
// ---------------------------------------------------------------------------
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const title = requireNonEmptyString(req.body.title, "title", { max: 200 });
    const odds = req.body.odds ? requireNonEmptyString(req.body.odds, "odds", { max: 40 }) : "1:1";
    const stake = requirePositiveAmount(req.body.stake, "stake");

    const prediction = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO predictions (title, odds, stake, status, creator_id)
         VALUES ($1, $2, $3, 'OPEN', $4)
         RETURNING *`,
        [title, odds, stake, req.user.id]
      );
      const created = rows[0];

      await lockFunds(client, { userId: req.user.id, amount: stake, predictionId: created.id });

      return fetchWithEmails(client, created.id);
    });

    res.status(201).json(toPublicPrediction(prediction));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /predictions — list markets, newest first. Optional ?status= filter.
// ---------------------------------------------------------------------------
router.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const status = req.query.status;
    const validStatuses = ["OPEN", "MATCHED", "DISPUTED", "SETTLED", "CANCELLED"];

    if (status && !validStatuses.includes(status)) {
      throw badRequest(`status must be one of: ${validStatuses.join(", ")}`);
    }

    const { rows } = await pool.query(
      `SELECT p.*, c.email AS creator_email, o.email AS opponent_email
       FROM predictions p
       JOIN users c ON c.id = p.creator_id
       LEFT JOIN users o ON o.id = p.opponent_id
       WHERE ($1::text IS NULL OR p.status = $1)
       ORDER BY p.created_at DESC
       LIMIT $2`,
      [status || null, limit]
    );

    res.json(rows.map(toPublicPrediction));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /predictions/:id — single market detail.
// ---------------------------------------------------------------------------
router.get("/:id", async (req, res, next) => {
  try {
    requireUuid(req.params.id, "id");

    const { rows } = await pool.query(
      `SELECT p.*, c.email AS creator_email, o.email AS opponent_email
       FROM predictions p
       JOIN users c ON c.id = p.creator_id
       LEFT JOIN users o ON o.id = p.opponent_id
       WHERE p.id = $1`,
      [req.params.id]
    );

    if (rows.length === 0) throw notFound("Market not found.");
    res.json(toPublicPrediction(rows[0]));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /predictions/:id/accept — take the other side. Locks the acceptor's stake.
// ---------------------------------------------------------------------------
router.post("/:id/accept", requireAuth, async (req, res, next) => {
  try {
    requireUuid(req.params.id, "id");

    const prediction = await withTransaction(async (client) => {
      // FOR UPDATE serializes concurrent accept attempts on the same market —
      // the second request blocks until the first commits, then sees
      // status = 'MATCHED' and is rejected, instead of both succeeding.
      const { rows } = await client.query(
        `SELECT * FROM predictions WHERE id = $1 FOR UPDATE`,
        [req.params.id]
      );
      const pred = rows[0];
      if (!pred) throw notFound("Market not found.");
      if (pred.status !== "OPEN") throw conflict("This market is no longer open.");
      if (pred.creator_id === req.user.id) throw forbidden("You can't accept your own market.");

      await lockFunds(client, {
        userId: req.user.id,
        amount: Number(pred.stake),
        predictionId: pred.id,
      });

      const { rows: updated } = await client.query(
        `UPDATE predictions
         SET status = 'MATCHED', opponent_id = $1, matched_at = now()
         WHERE id = $2
         RETURNING id`,
        [req.user.id, pred.id]
      );
      return fetchWithEmails(client, updated[0].id);
    });

    res.json(toPublicPrediction(prediction));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /predictions/:id/cancel — creator withdraws an OPEN (unmatched) market.
// ---------------------------------------------------------------------------
router.post("/:id/cancel", requireAuth, async (req, res, next) => {
  try {
    requireUuid(req.params.id, "id");

    const prediction = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM predictions WHERE id = $1 FOR UPDATE`,
        [req.params.id]
      );
      const pred = rows[0];
      if (!pred) throw notFound("Market not found.");
      if (pred.creator_id !== req.user.id) throw forbidden("Only the creator can cancel this market.");
      if (pred.status !== "OPEN") throw conflict("Only an open (unmatched) market can be cancelled.");

      await releaseFunds(client, {
        userId: req.user.id,
        amount: Number(pred.stake),
        predictionId: pred.id,
      });

      const { rows: updated } = await client.query(
        `UPDATE predictions SET status = 'CANCELLED' WHERE id = $1 RETURNING id`,
        [pred.id]
      );
      return fetchWithEmails(client, updated[0].id);
    });

    res.json(toPublicPrediction(prediction));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /predictions/:id/result — a participant reports who they believe won.
//
// Outcome authority is explicitly out of scope per the spec (no oracle, no
// admin review, no dispute resolution). This endpoint implements the
// smallest honest mechanism available without one: both participants must
// independently submit the same winner before any money moves. If they
// disagree, the market is marked DISPUTED and stays that way — funds
// remain locked rather than being paid out on a single party's say-so.
// ---------------------------------------------------------------------------
router.post("/:id/result", requireAuth, async (req, res, next) => {
  try {
    requireUuid(req.params.id, "id");
    const winnerId = requireUuid(req.body.winnerId, "winnerId");

    const outcome = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM predictions WHERE id = $1 FOR UPDATE`,
        [req.params.id]
      );
      const pred = rows[0];
      if (!pred) throw notFound("Market not found.");
      if (pred.status !== "MATCHED") {
        throw conflict("Only a matched market can have a result submitted.");
      }
      if (![pred.creator_id, pred.opponent_id].includes(req.user.id)) {
        throw forbidden("Only the two participants can report a result.");
      }
      if (![pred.creator_id, pred.opponent_id].includes(winnerId)) {
        throw badRequest("winnerId must be one of the two participants.");
      }

      const isCreator = req.user.id === pred.creator_id;
      const column = isCreator ? "creator_result" : "opponent_result";

      const { rows: updatedRows } = await client.query(
        `UPDATE predictions SET ${column} = $1 WHERE id = $2 RETURNING *`,
        [winnerId, pred.id]
      );
      let updated = updatedRows[0];

      const bothSubmitted = updated.creator_result && updated.opponent_result;
      if (!bothSubmitted) {
        return { prediction: await fetchWithEmails(client, pred.id), settled: false, disputed: false };
      }

      if (updated.creator_result !== updated.opponent_result) {
        await client.query(`UPDATE predictions SET status = 'DISPUTED' WHERE id = $1`, [pred.id]);
        return { prediction: await fetchWithEmails(client, pred.id), settled: false, disputed: true };
      }

      const loserId = updated.creator_result === pred.creator_id ? pred.opponent_id : pred.creator_id;

      await settle(client, {
        winnerId: updated.creator_result,
        loserId,
        stake: Number(pred.stake),
        predictionId: pred.id,
      });

      await client.query(
        `UPDATE predictions
         SET status = 'SETTLED', winner_id = $1, settled_at = now()
         WHERE id = $2`,
        [updated.creator_result, pred.id]
      );
      return { prediction: await fetchWithEmails(client, pred.id), settled: true, disputed: false };
    });

    res.json({
      ...toPublicPrediction(outcome.prediction),
      settled: outcome.settled,
      disputed: outcome.disputed,
    });
  } catch (err) {
    next(err);
  }
});

function toPublicPrediction(p) {
  return {
    id: p.id,
    title: p.title,
    odds: p.odds,
    stake: Number(p.stake),
    pot: Number(p.stake) * 2,
    status: p.status,
    creatorId: p.creator_id,
    creatorEmail: p.creator_email,
    opponentId: p.opponent_id,
    opponentEmail: p.opponent_email,
    winnerId: p.winner_id,
    createdAt: p.created_at,
    matchedAt: p.matched_at,
    settledAt: p.settled_at,
  };
}

export default router;
