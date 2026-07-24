const { pool } = require('../config/db');

// Gate for the Admin module. Requires BOTH that the user is currently
// ACTING AS Admin (req.roleCode, from the session — respects the role
// switcher, so someone with Admin+Finance who's switched to "Finance" is
// correctly locked out here) AND that Admin is still genuinely one of
// their assigned roles right now, re-checked against the database on every
// request rather than trusted from the session — so a role grant revoked
// mid-session can't still authorize access until their next /me refresh.
async function requireAdmin(req, res, next) {
  try {
    if (req.roleCode !== 'ADM') {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    const result = await pool.query(
      `SELECT 1 FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id AND r.code = 'ADM'
       JOIN users u ON u.id = ur.user_id
       WHERE ur.user_id = $1 AND u.company_id = $2 AND u.is_active = TRUE`,
      [req.userId, req.companyId]
    );
    if (!result.rows[0]) {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAdmin };
