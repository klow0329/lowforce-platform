const { pool } = require('../config/db');
const { isElevated } = require('./visibility');

// The tiered approval matrix: a company can add multiple rules of a given
// trigger type, each with its own value band and approver (e.g. Revenue:
// RM100,000 -> Finance Manager, RM1,000,000 -> CFO). The applicable
// approver for a given amount is whichever active rule of that trigger type
// has the highest threshold at or below it — a higher band supersedes a
// lower one rather than requiring every band's approver to sign off
// separately. An amount below every configured threshold (or a company
// with none configured for that trigger) falls back to the original
// behaviour: any Admin/Management can act. Shared by contract-value
// approval (REVENUE_ABOVE_THRESHOLD), Credit Note approval
// (CREDIT_NOTE_ISSUED) and Contract Reduction (CONTRACT_REDUCTION) — same
// matrix shape, different trigger_type.
//
// eventId, when supplied, also matches rules scoped to that specific event
// (ar.event_id = eventId) as well as company-wide rules (ar.event_id IS
// NULL) — an event-specific rule wins over a company-wide one at the same
// threshold, per the ORDER BY below.
async function getRequiredApprover(companyId, amountMyr, triggerType = 'REVENUE_ABOVE_THRESHOLD', eventId = null) {
  const result = await pool.query(
    `SELECT ar.approver_role_code, ar.approver_user_id, ar.threshold_value, ar.event_id,
            ar.backup_approver_user_id, ar.escalate_after_days, ar.escalate_to_role_code, ar.escalate_to_user_id,
            ar.step2_approver_role_code, ar.step2_approver_user_id,
            u.full_name AS approver_user_name,
            bu.full_name AS backup_approver_user_name,
            eu.full_name AS escalate_to_user_name,
            s2u.full_name AS step2_approver_user_name
     FROM approval_rules ar
     LEFT JOIN users u ON u.id = ar.approver_user_id
     LEFT JOIN users bu ON bu.id = ar.backup_approver_user_id
     LEFT JOIN users eu ON eu.id = ar.escalate_to_user_id
     LEFT JOIN users s2u ON s2u.id = ar.step2_approver_user_id
     WHERE ar.company_id = $1 AND ar.trigger_type = $3 AND ar.is_active = TRUE
       AND ar.threshold_value <= $2
       AND (ar.event_id IS NULL OR ar.event_id = $4)
     ORDER BY ar.threshold_value DESC, (ar.event_id = $4) DESC NULLS LAST
     LIMIT 1`,
    [companyId, amountMyr, triggerType, eventId]
  );
  return result.rows[0] || null;
}

function isPastEscalation(tier, pendingSince) {
  if (!tier?.escalate_after_days || !pendingSince) return false;
  if (!tier.escalate_to_role_code && !tier.escalate_to_user_id) return false;
  const elapsedMs = Date.now() - new Date(pendingSince).getTime();
  return elapsedMs >= Number(tier.escalate_after_days) * 24 * 60 * 60 * 1000;
}

// pendingSince (optional): when this request actually entered the pending
// state (e.g. the contract's last SUBMITTED/FLAGGED approval_log entry, or
// a Credit Note/Contract Reduction's created_at) — only needed to evaluate
// escalate_after_days; omit it and escalation simply never applies.
function canActOnTier(req, tier, pendingSince = null) {
  if (req.roleCode === 'ADM') return true; // Admin is always the fallback, per the same pattern as Budget
  if (!tier) return isElevated(req); // no tier matched -> default Admin/Management gate, unchanged
  const isPrimary = tier.approver_user_id ? tier.approver_user_id === req.userId : tier.approver_role_code === req.roleCode;
  if (isPrimary) return true;
  if (tier.backup_approver_user_id && tier.backup_approver_user_id === req.userId) return true;
  if (isPastEscalation(tier, pendingSince)) {
    if (tier.escalate_to_user_id && tier.escalate_to_user_id === req.userId) return true;
    if (tier.escalate_to_role_code && tier.escalate_to_role_code === req.roleCode) return true;
  }
  return false;
}

function hasStep2(tier) {
  return !!(tier && (tier.step2_approver_user_id || tier.step2_approver_role_code));
}

// Gates the SECOND approval step for a tier that has one configured (see
// hasStep2) — a separate, narrower check than canActOnTier, since once a
// request has moved past step 1 only the step-2 approver (or Admin) should
// be able to finalize or reject it, not whoever could act at step 1.
function canActOnStep2(req, tier) {
  if (req.roleCode === 'ADM') return true;
  if (!hasStep2(tier)) return isElevated(req);
  return tier.step2_approver_user_id ? tier.step2_approver_user_id === req.userId : tier.step2_approver_role_code === req.roleCode;
}

// ---------------------------------------------------------------------------
// Finance confirmation gates — Invoice Confirm, Credit Note Confirm, Payment
// Record. Deliberately a SEPARATE, narrower path from the tiered matrix
// above, not a reuse of getRequiredApprover/canActOnTier:
//   - There is no dollar threshold to tier by — it's simply "who is allowed
//     to do this at all" — so no threshold_value filtering.
//   - canActOnTier grants Admin an automatic bypass on every tier
//     ("Admin always can, regardless of tier"). These three actions were
//     previously hardcoded as Finance-only with Admin explicitly EXCLUDED
//     ("explicitly not even Admin/Management, per the user's own
//     instruction" — see the old CAN_CONFIRM_ROLES comments this replaced).
//     Reusing canActOnTier here would silently reintroduce an Admin
//     override nobody asked for, so this gate has its own, stricter
//     canActOnFinanceGate that never grants that bypass.
// Falls back to the FIN role when nothing is configured, which is the exact
// prior hardcoded behaviour — existing companies see no change until they
// deliberately add a rule for one of these trigger types.
async function getFinanceGateApprover(companyId, triggerType) {
  const result = await pool.query(
    `SELECT ar.approver_role_code, ar.approver_user_id, ar.backup_approver_user_id,
            u.full_name AS approver_user_name, bu.full_name AS backup_approver_user_name
     FROM approval_rules ar
     LEFT JOIN users u ON u.id = ar.approver_user_id
     LEFT JOIN users bu ON bu.id = ar.backup_approver_user_id
     WHERE ar.company_id = $1 AND ar.trigger_type = $2 AND ar.is_active = TRUE
     ORDER BY ar.sort_order LIMIT 1`,
    [companyId, triggerType]
  );
  return result.rows[0] || null;
}

function canActOnFinanceGate(req, tier) {
  if (!tier) return req.roleCode === 'FIN'; // unconfigured -> identical to the old hardcoded rule
  if (tier.approver_user_id) {
    if (tier.approver_user_id === req.userId) return true;
  } else if (tier.approver_role_code === req.roleCode) {
    return true;
  }
  return !!(tier.backup_approver_user_id && tier.backup_approver_user_id === req.userId);
}

function financeGateApproverLabel(tier) {
  if (!tier) return 'Finance';
  return tier.approver_user_name || tier.approver_role_code || 'Finance';
}

module.exports = {
  getRequiredApprover, canActOnTier, hasStep2, canActOnStep2,
  getFinanceGateApprover, canActOnFinanceGate, financeGateApproverLabel,
};
