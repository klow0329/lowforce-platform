const { pool } = require('../config/db');

// Auditor-facing read of the append-only audit_log trail — who did what,
// when, on which record. Admin-only (see routes), company-scoped, and
// nothing here ever writes to audit_log; recording happens in
// middleware/audit.js and the explicit auth.controller.js login/logout
// hooks, never from a user-facing endpoint.
async function listAuditLog(req, res) {
  const { from, to, user_id, entity_type, action, limit } = req.query;

  const conditions = ['company_id = $1'];
  const params = [req.companyId];

  if (from) { params.push(from); conditions.push(`created_at >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`created_at < ($${params.length}::date + interval '1 day')`); }
  if (user_id) { params.push(user_id); conditions.push(`user_id = $${params.length}`); }
  if (entity_type) { params.push(entity_type); conditions.push(`entity_type = $${params.length}`); }
  if (action) { params.push(action); conditions.push(`action = $${params.length}`); }

  const rowLimit = Math.min(Number(limit) || 500, 2000);
  params.push(rowLimit);

  const [rowsResult, optionsResult] = await Promise.all([
    pool.query(
      `SELECT id, user_id, user_name, role_code, action, entity_type, entity_id, details, created_at
       FROM audit_log
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    ),
    // Distinct filter options scoped to this company only — a fresh company
    // with no activity yet just sees empty dropdowns, not another
    // tenant's entity types.
    pool.query(
      `SELECT DISTINCT entity_type FROM audit_log WHERE company_id = $1 ORDER BY entity_type`,
      [req.companyId]
    ),
  ]);

  res.json({ entries: rowsResult.rows, entityTypes: optionsResult.rows.map((r) => r.entity_type) });
}

module.exports = { listAuditLog };
