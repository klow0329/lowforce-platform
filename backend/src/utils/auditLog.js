const { pool } = require('../config/db');

const REDACT_KEYS = new Set(['password', 'current_password', 'new_password', 'password_hash', 'temp_password']);

function redact(body) {
  if (!body || typeof body !== 'object') return undefined;
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = REDACT_KEYS.has(k) ? '[redacted]' : v;
  }
  return out;
}

// Append-only by convention — nothing in this codebase updates or deletes
// from audit_log. Insert failures are swallowed (logged to console) so a
// broken audit write never breaks the real request it's describing.
async function recordAudit({ companyId, userId, userName, roleCode, action, entityType, entityId, details }) {
  if (!companyId) return; // no tenant to attribute this to — nothing to log
  try {
    await pool.query(
      `INSERT INTO audit_log (company_id, user_id, user_name, role_code, action, entity_type, entity_id, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [companyId, userId || null, userName || null, roleCode || null, action, entityType, entityId || null, details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    console.error('Audit log insert failed:', err.message);
  }
}

module.exports = { recordAudit, redact };
