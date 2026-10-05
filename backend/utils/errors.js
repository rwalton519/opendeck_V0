/**
 * Mirrors FastAPI's HTTPException(status_code, detail). Every Python route in
 * the supplied project follows the pattern:
 *
 *   try:
 *       ...
 *   except Exception as e:
 *       raise HTTPException(status_code=400, detail=str(e))
 *
 * so business-logic errors thrown by the (unported) service layer will be
 * caught by the route handlers here and re-thrown as HttpError(400, message),
 * exactly as the Python code did.
 */
class HttpError extends Error {
  constructor(statusCode, detail) {
    super(typeof detail === 'string' ? detail : JSON.stringify(detail));
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

/**
 * Mirrors a FastAPI/Pydantic 422 validation error response shape:
 *   { "detail": [ { "loc": [...], "msg": "...", "type": "..." } ] }
 * This is a best-effort approximation - Pydantic's real "type" strings
 * (e.g. "greater_than", "missing", "string_type") are implementation
 * details of Pydantic itself and are approximated here, not reproduced exactly.
 */
class ValidationError extends HttpError {
  constructor(errors) {
    super(422, errors);
    this.errors = errors;
  }
}

function fieldError(loc, msg, type) {
  return { loc: ['body', loc], msg, type };
}

module.exports = { HttpError, ValidationError, fieldError };
