import { verifyToken } from "../utils/jwt.js";
import { unauthorized } from "../utils/AppError.js";

/**
 * Requires `Authorization: Bearer <token>`. On success sets
 * req.user = { id, email }. On failure, throws (caught by errorHandler)
 * rather than writing the response directly, so error shape stays
 * consistent with the rest of the API.
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return next(unauthorized("Missing or malformed Authorization header."));
  }

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (err) {
    next(unauthorized("Invalid or expired token."));
  }
}
