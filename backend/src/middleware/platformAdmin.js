const { pool } = require('../config/db');

// Gate for every /api/platform route.
//
// SECURITY: this checks `req.session.platformAdmin`, which is a DIFFERENT
// session key from the tenant `req.session.user` that attachTenant reads.
// The two are mutually exclusive by construction:
//   - a logged-in tenant user has no `.platformAdmin`, so they can never
//     reach a platform route no matter their role (not even company ADM);
//   - a logged-in platform admin has no `.user`, so they can never reach a
//     tenant route and silently act as somebody's company.
// There is deliberately no "elevate" path between them — switching sides
// means logging out and logging in again.
//
// Re-checked against the DB on every request (not trusted from the session
// alone) so deactivating a platform admin takes effect immediately rather
// than whenever their session happens to expire.
async function requirePlatformAdmin(req, res, next) {
  try {
    const sessionAdmin = req.session && req.session.platformAdmin;
    if (!sessionAdmin) {
      return res.status(401).json({ error: 'Platform administrator login required.' });
    }
    const result = await pool.query(
      `SELECT id, email, full_name FROM platform_admins WHERE id = $1 AND is_active = TRUE`,
      [sessionAdmin.id]
    );
    if (!result.rows[0]) {
      return req.session.destroy(() => res.status(401).json({ error: 'This platform account is no longer active.' }));
    }
    req.platformAdmin = result.rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requirePlatformAdmin };
