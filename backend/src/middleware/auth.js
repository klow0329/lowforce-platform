// Blocks any request that doesn't have a valid logged-in session.
// On success, req.session.user is already populated by the login route
// (see controllers/auth.controller.js) — this just enforces that it exists.
function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Not logged in.' });
  }
  next();
}

module.exports = { requireLogin };
