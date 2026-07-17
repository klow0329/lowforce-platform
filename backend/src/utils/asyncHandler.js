// Express 4 doesn't catch rejected promises from async route handlers —
// an unhandled rejection just leaves the request hanging. Wrapping routes
// with this forwards any thrown/rejected error to the error middleware.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { asyncHandler };
