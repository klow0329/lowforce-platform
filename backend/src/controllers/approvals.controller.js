const { pool } = require('../config/db');
const { getRequiredApprover, canActOnTier, hasStep2, canActOnStep2 } = require('../utils/approverMatrix');
const { releaseFloorPlanBooth } = require('../utils/floorPlanSync');
const { syncBoothFieldsAndMirror } = require('../utils/opportunitySync');

// When this contract most recently entered a pending-approval state —
// needed to evaluate a tier's escalate_after_days. Covers both a manual
// Send for Approval (SUBMITTED) and an auto-trigger (FLAGGED, e.g. a
// post-approval edit re-flagging an already-approved contract).
async function getPendingSince(salesOrderId) {
  const result = await pool.query(
    `SELECT MAX(created_at) AS since FROM approval_log WHERE sales_order_id = $1 AND action IN ('SUBMITTED', 'FLAGGED')`,
    [salesOrderId]
  );
  return result.rows[0]?.since || null;
}

// Which rule actually put this contract into its current pending state —
// the most recent SUBMITTED (manual Send for Approval, trigger_type NULL)
// or FLAGGED (an auto-trigger — discount/revenue/post-approval-edit —
// trigger_type set by flagForApproval) row. The approval GATE below used to
// always check REVENUE_ABOVE_THRESHOLD regardless of this, which meant a
// "Contract edited after approval" rule configured to route to Management
// was silently ignored the moment someone actually clicked Approve —
// whoever satisfied the (unrelated) revenue tier could approve it instead,
// even Sales (2026-08-01 user report). Falls back to
// REVENUE_ABOVE_THRESHOLD for a plain manual submission, or if two triggers
// fired for the same episode this picks the most recent one — not a full
// most-restrictive-wins resolution, but correct for the common case.
async function getPendingTriggerType(salesOrderId) {
  const result = await pool.query(
    `SELECT trigger_type FROM approval_log WHERE sales_order_id = $1 AND action IN ('SUBMITTED', 'FLAGGED') ORDER BY created_at DESC LIMIT 1`,
    [salesOrderId]
  );
  return result.rows[0]?.trigger_type || 'REVENUE_ABOVE_THRESHOLD';
}

async function listRules(req, res) {
  const result = await pool.query(
    `SELECT ar.*, ev.name AS event_name, u.full_name AS approver_user_name,
            bu.full_name AS backup_approver_user_name, eu.full_name AS escalate_to_user_name,
            s2u.full_name AS step2_approver_user_name
     FROM approval_rules ar
     LEFT JOIN events ev ON ev.id = ar.event_id
     LEFT JOIN users u ON u.id = ar.approver_user_id
     LEFT JOIN users bu ON bu.id = ar.backup_approver_user_id
     LEFT JOIN users eu ON eu.id = ar.escalate_to_user_id
     LEFT JOIN users s2u ON s2u.id = ar.step2_approver_user_id
     WHERE ar.company_id = $1 ORDER BY ar.trigger_type, ar.sort_order`,
    [req.companyId]
  );
  res.json({ rules: result.rows });
}

const OPTIONAL_RULE_FIELDS = [
  'event_id', 'backup_approver_user_id', 'escalate_after_days', 'escalate_to_role_code', 'escalate_to_user_id',
  'step2_approver_role_code', 'step2_approver_user_id',
];

async function createRule(req, res) {
  const { trigger_type, threshold_type, threshold_value, approver_role_code, approver_user_id } = req.body;
  if (!trigger_type) {
    return res.status(400).json({ error: 'trigger_type is required.' });
  }
  const optional = {};
  for (const f of OPTIONAL_RULE_FIELDS) optional[f] = req.body[f] || null;

  const sortResult = await pool.query(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM approval_rules WHERE company_id = $1`,
    [req.companyId]
  );
  const result = await pool.query(
    `INSERT INTO approval_rules (
       company_id, trigger_type, threshold_type, threshold_value, approver_role_code, approver_user_id, sort_order,
       event_id, backup_approver_user_id, escalate_after_days, escalate_to_role_code, escalate_to_user_id,
       step2_approver_role_code, step2_approver_user_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
    [
      req.companyId, trigger_type, threshold_type || null, threshold_value || null,
      approver_role_code || null, approver_user_id || null, sortResult.rows[0].next,
      optional.event_id, optional.backup_approver_user_id, optional.escalate_after_days,
      optional.escalate_to_role_code, optional.escalate_to_user_id,
      optional.step2_approver_role_code, optional.step2_approver_user_id,
    ]
  );
  res.status(201).json({ rule: { id: result.rows[0].id } });
}

async function updateRule(req, res) {
  const fields = {};
  for (const f of [
    'threshold_type', 'threshold_value', 'approver_role_code', 'approver_user_id', 'is_active',
    ...OPTIONAL_RULE_FIELDS,
  ]) {
    if (f in req.body) fields[f] = req.body[f] === '' ? null : req.body[f];
  }
  const cols = Object.keys(fields);
  if (cols.length === 0) return res.json({ rule: { id: req.params.id } });

  const setClause = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
  const result = await pool.query(
    `UPDATE approval_rules SET ${setClause} WHERE id = $1 AND company_id = $2 RETURNING id`,
    [req.params.id, req.companyId, ...cols.map((c) => fields[c])]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Rule not found.' });
  res.json({ rule: { id: req.params.id } });
}

async function deleteRule(req, res) {
  const result = await pool.query(
    `DELETE FROM approval_rules WHERE id = $1 AND company_id = $2 RETURNING id`,
    [req.params.id, req.companyId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Rule not found.' });
  res.json({ success: true });
}

async function listApprovalLog(req, res) {
  const result = await pool.query(
    `SELECT al.*, u.full_name AS actor_name
     FROM approval_log al
     LEFT JOIN users u ON u.id = al.actor_user_id
     JOIN sales_orders so ON so.id = al.sales_order_id
     WHERE al.sales_order_id = $1 AND so.company_id = $2
     ORDER BY al.created_at DESC`,
    [req.params.id, req.companyId]
  );
  res.json({ log: result.rows });
}

// The contract's own assigned salesperson (falling back to the exhibitor's,
// same pattern reports.controller.js's Task To-Do queries already use) —
// the only person allowed to send it for approval or withdraw it. Was
// previously unchecked entirely, so any logged-in user in any department
// could do either (2026-08-01 user instruction: "only sales can edit and
// withdrawn... no other department" — no Admin bypass either, matching the
// same rule just applied to Value Change requests).
async function getContractOwner(salesOrderId, companyId) {
  const result = await pool.query(
    `SELECT COALESCE(so.salesperson_id, ex.salesperson_id) AS owner_id
     FROM sales_orders so JOIN exhibitors ex ON ex.id = so.exhibitor_id
     WHERE so.id = $1 AND so.company_id = $2`,
    [salesOrderId, companyId]
  );
  return result.rows[0]?.owner_id || null;
}

// Any user who can edit the contract can send it for approval — this is the
// step that moves a contract off Draft, where it's freely editable and
// invisible to invoicing, into the Admin/Management approval queue.
async function submitForApproval(req, res) {
  const ownerId = await getContractOwner(req.params.id, req.companyId);
  if (ownerId && ownerId !== req.userId) {
    return res.status(403).json({ error: 'Only this contract\'s own salesperson can send it for approval.' });
  }
  const result = await pool.query(
    `UPDATE sales_orders SET status = 'PENDING_APPROVAL', rejected_at = NULL
     WHERE id = $1 AND company_id = $2 AND status = 'DRAFT' RETURNING id`,
    [req.params.id, req.companyId]
  );
  if (!result.rows[0]) {
    return res.status(400).json({ error: 'Contract is not in Draft status.' });
  }
  await pool.query(
    `INSERT INTO approval_log (sales_order_id, action, actor_user_id, notes) VALUES ($1, 'SUBMITTED', $2, $3)`,
    [req.params.id, req.userId, req.body.notes || null]
  );
  res.json({ success: true });
}

// Self-service undo for Sales — no approver gate, since this only ever
// moves a contract BACK to Draft (the same place it'd land if rejected),
// not forward. Lets someone pull back a submission made too early without
// waiting on Admin/Management to reject it for them.
async function withdrawApproval(req, res) {
  const ownerId = await getContractOwner(req.params.id, req.companyId);
  if (ownerId && ownerId !== req.userId) {
    return res.status(403).json({ error: 'Only this contract\'s own salesperson can withdraw it.' });
  }
  const result = await pool.query(
    `UPDATE sales_orders SET status = 'DRAFT'
     WHERE id = $1 AND company_id = $2 AND status IN ('PENDING_APPROVAL', 'PENDING_APPROVAL_STEP2') RETURNING id`,
    [req.params.id, req.companyId]
  );
  if (!result.rows[0]) {
    return res.status(400).json({ error: 'Contract is not pending approval.' });
  }
  await pool.query(
    `INSERT INTO approval_log (sales_order_id, action, actor_user_id, notes) VALUES ($1, 'WITHDRAWN', $2, $3)`,
    [req.params.id, req.userId, req.body.notes || null]
  );
  res.json({ success: true });
}

// Gated by the tiered revenue matrix above when one applies to this
// contract's value, falling back to the original Admin/Management-only
// gate otherwise (see getRequiredApprover/canActOnTier). A tier with a
// step-2 approver configured splits this into two calls: the first moves
// the contract to PENDING_APPROVAL_STEP2 (no booth-winner effects yet —
// the contract isn't actually approved), the second (gated by
// canActOnStep2) finalizes it exactly as a single-step approval always has.
async function approveSalesOrder(req, res) {
  const so = await pool.query(
    `SELECT total_myr, total_sqm, total_foreign, currency, event_id, status FROM sales_orders WHERE id = $1 AND company_id = $2`,
    [req.params.id, req.companyId]
  );
  if (!so.rows[0]) return res.status(404).json({ error: 'Contract not found.' });
  const { total_myr, total_sqm, total_foreign, currency, event_id, status } = so.rows[0];

  const pendingTriggerType = await getPendingTriggerType(req.params.id);
  const tier = await getRequiredApprover(req.companyId, Number(total_myr) || 0, pendingTriggerType, event_id);

  if (status === 'PENDING_APPROVAL' && hasStep2(tier)) {
    const pendingSince = await getPendingSince(req.params.id);
    if (!canActOnTier(req, tier, pendingSince)) {
      const who = tier.approver_user_name || `the ${tier.approver_role_code} role`;
      return res.status(403).json({ error: `Only ${who} (1st approval) can approve this contract (RM${Number(total_myr).toLocaleString('en-MY')}).` });
    }
    const result = await pool.query(
      `UPDATE sales_orders SET status = 'PENDING_APPROVAL_STEP2', rejected_at = NULL
       WHERE id = $1 AND company_id = $2 AND status = 'PENDING_APPROVAL' RETURNING id`,
      [req.params.id, req.companyId]
    );
    if (!result.rows[0]) return res.status(400).json({ error: 'Contract is not pending approval.' });
    const who2 = tier.step2_approver_user_name || `the ${tier.step2_approver_role_code} role`;
    await pool.query(
      `INSERT INTO approval_log (sales_order_id, action, actor_user_id, notes) VALUES ($1, 'APPROVED_STEP1', $2, $3)`,
      [req.params.id, req.userId, req.body.notes || `1st approval given — now awaiting ${who2} (2nd approval).`]
    );
    return res.json({ success: true, pendingStep2: true });
  }

  if (status === 'PENDING_APPROVAL_STEP2') {
    if (!canActOnStep2(req, tier)) {
      const who = tier?.step2_approver_user_name || `the ${tier?.step2_approver_role_code} role`;
      return res.status(403).json({ error: `Only ${who} (2nd approval) can approve this contract (RM${Number(total_myr).toLocaleString('en-MY')}).` });
    }
  } else if (status === 'PENDING_APPROVAL') {
    const pendingSince = await getPendingSince(req.params.id);
    if (!canActOnTier(req, tier, pendingSince)) {
      const who = tier ? (tier.approver_user_name || `the ${tier.approver_role_code} role`) : 'Admin/Management';
      return res.status(403).json({ error: `Only ${who} can approve this contract (RM${Number(total_myr).toLocaleString('en-MY')}).` });
    }
  } else {
    return res.status(400).json({ error: 'Contract is not pending approval.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE sales_orders SET status = 'APPROVED', approval_acknowledged_by = NULL, approval_acknowledged_at = NULL, rejected_at = NULL
       WHERE id = $1 AND company_id = $2 AND status IN ('PENDING_APPROVAL', 'PENDING_APPROVAL_STEP2') RETURNING id`,
      [req.params.id, req.companyId]
    );
    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Contract is not pending approval.' });
    }
    // A plain "Approve" click never asks for a reason, so notes came in
    // blank here before — the Approval History row just read "—" with
    // nothing to say WHAT was approved (2026-08-01 user request: show the
    // contract's actual value/sqm at the moment of approval, not a blank
    // entry).
    const defaultApprovalNote = `${Number(total_sqm) || 0} sqm, ${currency} ${Number(total_foreign).toLocaleString('en-MY', { minimumFractionDigits: 2 })} (RM${Number(total_myr).toLocaleString('en-MY', { minimumFractionDigits: 2 })}).`;
    await client.query(
      `INSERT INTO approval_log (sales_order_id, action, actor_user_id, notes) VALUES ($1, 'APPROVED', $2, $3)`,
      [req.params.id, req.userId, req.body.notes || defaultApprovalNote]
    );

    // Winner takes all: any booth this now-APPROVED contract is claiming
    // becomes genuinely SOLD to it, and every OTHER Opportunity/draft
    // Contract still competing for that same booth (competing-claims rule,
    // Round 6 item 4) loses its claim and gets notified to re-pick.
    const wonBooths = await client.query(
      `SELECT booth_id FROM floor_plan_booth_claims WHERE record_type = 'sales_order' AND record_id = $1 AND released_at IS NULL`,
      [req.params.id]
    );
    const boothIds = wonBooths.rows.map((r) => r.booth_id);
    if (boothIds.length > 0) {
      await client.query(
        `UPDATE floor_plan_booths SET sales_order_id = $1, opportunity_id = NULL WHERE id = ANY($2::uuid[])`,
        [req.params.id, boothIds]
      );
      const losers = await client.query(
        `UPDATE floor_plan_booth_claims SET released_at = now(), release_reason = 'LOST_TO_APPROVAL'
         WHERE booth_id = ANY($1::uuid[]) AND released_at IS NULL
           AND NOT (record_type = 'sales_order' AND record_id = $2)
         RETURNING record_type, record_id`,
        [boothIds, req.params.id]
      );
      const distinctLosers = new Map(losers.rows.map((r) => [`${r.record_type}:${r.record_id}`, r]));
      for (const loser of distinctLosers.values()) {
        // A losing claimant can itself be a draft Contract — its own
        // Opportunity needs to see the shrunk booth set too, not just the
        // Contract's own cached fields (2026-08-01 fix).
        await syncBoothFieldsAndMirror(client, req.companyId, loser.record_type, loser.record_id);
      }
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Mirrors invoices.controller.js's acknowledgeConfirm / creditNotes'
// acknowledgeCnConfirm — lets Sales clear the "your contract was approved"
// Task To-Do item once they've seen it. Works for either APPROVED or the
// DRAFT-after-reject state, since both are worth surfacing back to Sales.
async function acknowledgeApproval(req, res) {
  const result = await pool.query(
    `UPDATE sales_orders SET approval_acknowledged_by = $1, approval_acknowledged_at = now()
     WHERE id = $2 AND company_id = $3 RETURNING id`,
    [req.userId, req.params.id, req.companyId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Contract not found.' });
  res.json({ success: true });
}

async function rejectSalesOrder(req, res) {
  const so = await pool.query(
    `SELECT total_myr, event_id, status FROM sales_orders WHERE id = $1 AND company_id = $2`,
    [req.params.id, req.companyId]
  );
  if (!so.rows[0]) return res.status(404).json({ error: 'Contract not found.' });
  const { total_myr, event_id, status } = so.rows[0];

  const pendingTriggerType = await getPendingTriggerType(req.params.id);
  const tier = await getRequiredApprover(req.companyId, Number(total_myr) || 0, pendingTriggerType, event_id);

  // Once step 1 has signed off, rejection authority follows the step-2
  // approver (whoever is currently "holding" the request) rather than
  // reverting to the step-1 approver — Admin can always override either way.
  if (status === 'PENDING_APPROVAL_STEP2') {
    if (!canActOnStep2(req, tier)) {
      const who = tier?.step2_approver_user_name || `the ${tier?.step2_approver_role_code} role`;
      return res.status(403).json({ error: `Only ${who} (2nd approval) can reject this contract (RM${Number(total_myr).toLocaleString('en-MY')}).` });
    }
  } else {
    const pendingSince = await getPendingSince(req.params.id);
    if (!canActOnTier(req, tier, pendingSince)) {
      const who = tier ? (tier.approver_user_name || `the ${tier.approver_role_code} role`) : 'Admin/Management';
      return res.status(403).json({ error: `Only ${who} can reject this contract (RM${Number(total_myr).toLocaleString('en-MY')}).` });
    }
  }

  const result = await pool.query(
    `UPDATE sales_orders SET status = 'DRAFT', approval_acknowledged_by = NULL, approval_acknowledged_at = NULL, rejected_at = now()
     WHERE id = $1 AND company_id = $2 AND status IN ('PENDING_APPROVAL', 'PENDING_APPROVAL_STEP2') RETURNING id`,
    [req.params.id, req.companyId]
  );
  if (!result.rows[0]) {
    return res.status(400).json({ error: 'Contract is not pending approval.' });
  }
  await pool.query(
    `INSERT INTO approval_log (sales_order_id, action, actor_user_id, notes) VALUES ($1, 'REJECTED', $2, $3)`,
    [req.params.id, req.userId, req.body.notes || null]
  );
  res.json({ success: true });
}

// A contract that has NOT yet had any invoice issued can be voided instead
// of edited — this is the correct undo path for "we made a mistake before
// invoicing" (wrong exhibitor, duplicate entry, deal actually fell through
// after the contract was drawn up, etc). Voiding auto-marks the linked
// Opportunity as Lost and releases any booth held by either record, so the
// Floor Plan never keeps showing a booth against a dead deal. Once an
// invoice exists, use a Credit Note instead — that path exists precisely
// because the contract is no longer safe to just undo.
async function voidSalesOrder(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const so = await client.query(
      `SELECT id, status, opportunity_id FROM sales_orders WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [req.params.id, req.companyId]
    );
    if (!so.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Contract not found.' });
    }
    const salesOrder = so.rows[0];
    if (!['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(salesOrder.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This contract cannot be voided from its current status.' });
    }

    const invCheck = await client.query(`SELECT COUNT(*) FROM invoices WHERE sales_order_id = $1`, [req.params.id]);
    if (Number(invCheck.rows[0].count) > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'An invoice has already been issued against this contract — Void only applies before invoicing. Use a Credit Note to reduce value instead.' });
    }

    await client.query(
      `UPDATE sales_orders SET status = 'VOID', voided_by = $1, voided_at = now(), void_reason = $2 WHERE id = $3`,
      [req.userId, req.body.reason || null, req.params.id]
    );
    await client.query(
      `INSERT INTO approval_log (sales_order_id, action, actor_user_id, notes) VALUES ($1, 'VOIDED', $2, $3)`,
      [req.params.id, req.userId, req.body.reason || null]
    );

    await releaseFloorPlanBooth(client, req.companyId, 'sales_order_id', req.params.id);

    if (salesOrder.opportunity_id) {
      const lostStage = await client.query(
        `SELECT id FROM sales_stages WHERE company_id = $1 AND is_lost = TRUE ORDER BY sort_order LIMIT 1`,
        [req.companyId]
      );
      if (lostStage.rows[0]) {
        await client.query(
          `UPDATE opportunities SET stage_id = $1 WHERE id = $2 AND company_id = $3`,
          [lostStage.rows[0].id, salesOrder.opportunity_id, req.companyId]
        );
      }
      await releaseFloorPlanBooth(client, req.companyId, 'opportunity_id', salesOrder.opportunity_id);
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  listRules, createRule, updateRule, deleteRule, listApprovalLog, submitForApproval, withdrawApproval,
  approveSalesOrder, rejectSalesOrder, voidSalesOrder, acknowledgeApproval,
};
