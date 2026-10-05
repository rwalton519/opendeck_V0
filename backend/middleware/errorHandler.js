const { HttpError } = require('../utils/errors');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.statusCode).json({ detail: err.detail });
  }

  // Anything unexpected that wasn't wrapped in try/catch -> matches FastAPI's
  // default unhandled-exception behavior (500).
  console.error(err);
  return res.status(500).json({ detail: 'Internal Server Error' });
}

module.exports = errorHandler;
