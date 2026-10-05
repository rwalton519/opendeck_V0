/**
 * An error with an HTTP status attached, so route handlers can `throw`
 * instead of manually shaping every error response. Caught centrally by
 * the error-handling middleware in src/middleware/errorHandler.js.
 */
export class AppError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new AppError(400, msg, details);
export const unauthorized = (msg = "Unauthorized") => new AppError(401, msg);
export const forbidden = (msg = "Forbidden") => new AppError(403, msg);
export const notFound = (msg = "Not found") => new AppError(404, msg);
export const conflict = (msg, details) => new AppError(409, msg, details);
