import { badRequest } from "./AppError.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

export function requireUuid(value, field) {
  if (!isUuid(value)) throw badRequest(`${field} must be a valid id.`);
  return value;
}

export function requireEmail(value) {
  if (typeof value !== "string" || !EMAIL_RE.test(value)) {
    throw badRequest("A valid email is required.");
  }
  return value.trim().toLowerCase();
}

export function requirePassword(value) {
  if (typeof value !== "string" || value.length < 8) {
    throw badRequest("Password must be at least 8 characters.");
  }
  return value;
}

export function requireNonEmptyString(value, field, { max = 200 } = {}) {
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest(`${field} is required.`);
  }
  if (value.length > max) {
    throw badRequest(`${field} must be ${max} characters or fewer.`);
  }
  return value.trim();
}

export function requirePositiveAmount(value, field) {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
    throw badRequest(`${field} must be a positive number.`);
  }
  // two decimal places max — this is money
  return Math.round(n * 100) / 100;
}
