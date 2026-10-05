import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { notFound } from "../utils/AppError.js";

const router = Router();

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, balance, locked_balance, created_at FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (rows.length === 0) throw notFound("User not found.");

    const u = rows[0];
    res.json({
      id: u.id,
      email: u.email,
      balance: Number(u.balance),
      lockedBalance: Number(u.locked_balance),
      createdAt: u.created_at,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/me/transactions", requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const { rows } = await pool.query(
      `SELECT id, prediction_id, amount, type, created_at
       FROM transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [req.user.id, limit]
    );

    res.json(
      rows.map((t) => ({
        id: t.id,
        predictionId: t.prediction_id,
        amount: Number(t.amount),
        type: t.type,
        createdAt: t.created_at,
      }))
    );
  } catch (err) {
    next(err);
  }
});

export default router;
