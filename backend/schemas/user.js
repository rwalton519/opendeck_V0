// Converted from schemas/user.py. Pydantic's BaseModel classes are primarily
// static validation/serialization schemas - there's no direct runtime
// equivalent in a plain Express app (no framework-level automatic
// request/response validation the way FastAPI has). These are kept as
// small helper functions performing the equivalent shape checks /
// field-stripping by hand, used wherever the Python code did
// `data: UserCreate` (validate incoming body) or `response_model=UserOut`
// (strip down outgoing object).

/**
 * UserBase / UserCreate: { email: EmailStr, username: str, password: str }
 * Minimal hand-rolled validation - not a full email-format check the way
 * Pydantic's EmailStr does; consider adding a proper validator (e.g. a
 * regex or a library like `validator`) if strict email validation matters.
 */
function parseUserCreate(body) {
  const { email, username, password } = body || {};
  if (typeof email !== 'string' || !email.includes('@')) {
    const err = new Error('email: invalid or missing');
    err.statusCode = 422;
    throw err;
  }
  if (typeof username !== 'string' || username.length === 0) {
    const err = new Error('username: field required');
    err.statusCode = 422;
    throw err;
  }
  if (typeof password !== 'string' || password.length === 0) {
    const err = new Error('password: field required');
    err.statusCode = 422;
    throw err;
  }
  return { email, username, password };
}

/**
 * UserOut: { id: int, email: EmailStr, username: str } (from_attributes=True
 * -> built from an ORM instance, password excluded).
 */
function toUserOut(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
  };
}

module.exports = { parseUserCreate, toUserOut };
