// Small shared helper so every call site resolves the client IP the same
// way, instead of each router reaching into req.ip / req.headers directly.
//
// req.ip only reflects the real client address (rather than nginx's own
// address on 127.0.0.1) if Express's `trust proxy` setting is enabled -
// see server.js's `app.set('trust proxy', ...)` and its comment for what
// that does and why it's safe to enable here specifically.
function getClientIp(req) {
  return req.ip || null;
}

module.exports = { getClientIp };
