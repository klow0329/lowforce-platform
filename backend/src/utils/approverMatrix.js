const { pool } = require('../config/db');
const { isElevated } = require('./visibility');

// The tiered approval matrix: a company can add multiple
// REVENUE_ABOVE_THRESHOLD rules, each with its own value band and approver
// (e.g. RM100,000 -> Finance Manager, RM1,000,000 -> CFO). The applicable
// approver for a given contract is whichever active rule has the highest
// threshold at or below the contract's total — a higher band supersedes a
// lower one rather than requiring every band's approver to sign off
// separately. A contract below every configured threshold (or a company
// with none configured) falls back to the original behaviour: any
// Admin/Management can approve.
async function getRequiredApprover(companyId, totalMyr) {
  const result = await pool.query(
    `SELECT approver_role_code, approver_user_id, threshold_value, u.full_name AS approver_user_name
     FROM approval_rules ar
     LEFT JOIN users u ON u.id = ar.approver_user_id
     WHERE ar.company_id = $1 AND ar.trigger_type = 'REVENUE_ABOVE_THRESHOLD' AND ar.is_active = TRUE
       AND ar.threshold_value <= $2
     ORDER BY ar.threshold_value DESC
     LIMIT 1`,
    [companyId, totalMyr]
  );
  return result.rows[0] || null;
}

function canActOnTier(req, tier) {
  if (req.roleCode === 'ADM') return true; // Admin is always the fallback, per the same pattern as Budget
  if (!tier) return isElevated(req); // no tier matched -> default Admin/Management gate, unchanged
  return tier.approver_user_id ? tier.approver_user_id === req.userId : tier.approver_role_code === req.roleCode;
}

module.exports = { getRequiredApprover, canActOnTier };
