const Decimal = require('decimal.js');
const { ValidationError, fieldError } = require('./errors');

/**
 * Replicates: Field(..., description="...") on a str -> required, non-empty string.
 */
function requireString(body, field) {
  const value = body ? body[field] : undefined;
  if (value === undefined || value === null || typeof value !== 'string' || value.length === 0) {
    throw new ValidationError([fieldError(field, 'field required', 'missing')]);
  }
  return value;
}

/**
 * Replicates: field: str | None = None -> optional string, defaults to null.
 */
function optionalString(body, field) {
  const value = body ? body[field] : undefined;
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new ValidationError([fieldError(field, 'str type expected', 'string_type')]);
  }
  return value;
}

/**
 * Replicates: amount: Decimal = Field(..., gt=0) -> required, > 0. Uses
 * decimal.js to mirror Python's Decimal (avoids float rounding issues for money).
 */
function requireDecimalGtZero(body, field) {
  const raw = body ? body[field] : undefined;
  if (raw === undefined || raw === null || raw === '') {
    throw new ValidationError([fieldError(field, 'field required', 'missing')]);
  }
  let value;
  try {
    value = new Decimal(raw);
  } catch (e) {
    throw new ValidationError([fieldError(field, 'value is not a valid decimal', 'decimal_parsing')]);
  }
  if (!value.isFinite() || value.lte(0)) {
    throw new ValidationError([fieldError(field, 'ensure this value is greater than 0', 'greater_than')]);
  }
  return value;
}

/**
 * Replicates: amount: float -> required plain number (compliance_router,
 * admin_router use float rather than Decimal).
 */
function requireFloat(body, field) {
  const raw = body ? body[field] : undefined;
  if (raw === undefined || raw === null || raw === '') {
    throw new ValidationError([fieldError(field, 'field required', 'missing')]);
  }
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new ValidationError([fieldError(field, 'value is not a valid float', 'float_parsing')]);
  }
  return value;
}

/**
 * Replicates: field: int -> required integer.
 */
function requireInt(body, field) {
  const raw = body ? body[field] : undefined;
  if (raw === undefined || raw === null || raw === '') {
    throw new ValidationError([fieldError(field, 'field required', 'missing')]);
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new ValidationError([fieldError(field, 'value is not a valid integer', 'int_parsing')]);
  }
  return value;
}

/**
 * Replicates: field: int = <default> -> optional integer with a default.
 */
function optionalIntWithDefault(body, field, defaultValue) {
  const raw = body ? body[field] : undefined;
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new ValidationError([fieldError(field, 'value is not a valid integer', 'int_parsing')]);
  }
  return value;
}

/**
 * Replicates: field: list -> required array (tournament_router CreateTournamentRequest.levels).
 */
function requireList(body, field) {
  const value = body ? body[field] : undefined;
  if (!Array.isArray(value)) {
    throw new ValidationError([fieldError(field, 'value is not a valid list', 'list_type')]);
  }
  return value;
}

/**
 * Replicates: field: dict -> required plain object (tournament_router
 * UpdateChipsRequest.results, FinalizeRequest.payouts, cashgame_router
 * SettleHandRequest.results).
 */
function requireDict(body, field) {
  const value = body ? body[field] : undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError([fieldError(field, 'value is not a valid dict', 'dict_type')]);
  }
  return value;
}

module.exports = {
  requireString,
  optionalString,
  requireDecimalGtZero,
  requireFloat,
  requireInt,
  optionalIntWithDefault,
  requireList,
  requireDict,
};
