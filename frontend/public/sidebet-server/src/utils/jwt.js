import jwt from "jsonwebtoken";

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "2h" }
  );
}

export function verifyToken(token) {
  // Throws if invalid/expired — callers catch this.
  return jwt.verify(token, process.env.JWT_SECRET);
}
