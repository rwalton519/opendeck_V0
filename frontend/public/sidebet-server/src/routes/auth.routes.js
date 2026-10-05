import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { signToken } from "../utils/jwt.js";
import { requireEmail, requirePassword } from "../utils/validate.js";
import { unauthorized } from "../utils/AppError.js";

const router = Router();
const BCRYPT_ROUNDS = 12;

router.post("/register", async (req, res, next) => {
  try {
    const email = requireEmail(req.body.email);
    const password = requirePassword(req.body.password);

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, balance, locked_balance, created_at`,
      [email, passwordHash]
    );

    const user = rows[0];
    const token = signToken(user);

    res.status(201).json({ token, user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const email = requireEmail(req.body.email);
    const password = typeof req.body.password === "string" ? req.body.password : "";

    const { rows } = await pool.query(
      `SELECT id, email, password_hash, balance, locked_balance FROM users WHERE email = $1`,
      [email]
    );
    const user = rows[0];

    // Same error whether the email doesn't exist or the password is wrong —
    // don't let the API reveal which emails are registered.
    if (!user) throw unauthorized("Invalid email or password.");

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) throw unauthorized("Invalid email or password.");

    const token = signToken(user);
    res.json({ token, user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

function toPublicUser(u) {
  return {
    id: u.id,
    email: u.email,
    balance: Number(u.balance),
    lockedBalance: Number(u.locked_balance),
  };
}

export default router;
