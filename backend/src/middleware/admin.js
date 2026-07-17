const { pool } = require('../config/db');

// Gate for the Admin module. Checks the database on every request rather
// than the session, so a demoted admin loses access immediately.
// Phase 1 keeps this simple: the role whose code is ADM is the admin role
// (that's what the seed creates). The roles.permissions JSONB is the hook
// for finer-grained checks later.
async function requireAdmin(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT r.code FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.company_id = $2 AND u.is_active = TRUE`,
      [req.userId, req.companyId]
    );
    if (result.rows[0]?.code !== 'ADM') {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAdmin };
