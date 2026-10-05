import { AppError } from "../utils/AppError.js";

// Postgres error codes we want to translate into clean 4xx responses
// instead of leaking a raw 500 + driver message to the client.
const PG_ERROR_MESSAGES = {
  "23505": "That record already exists.", // unique_violation (e.g. duplicate email)
  "23514": "That request violates a data constraint.", // check_violation
  "23503": "Referenced record does not exist.", // foreign_key_violation
};

export function notFoundHandler(req, res) {
  res.status(404).json({ error: "Route not found." });
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  if (err && err.code && PG_ERROR_MESSAGES[err.code]) {
    return res.status(409).json({ error: PG_ERROR_MESSAGES[err.code] });
  }

  // Unexpected error — log full detail server-side, return a generic
  // message to the client. Never forward raw DB/driver errors to callers.
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error." });
}
