const { pool } = require('../config/db');
const { isElevated } = require('../utils/visibility');

async function listRules(req, res) {
  const result = await pool.query(
    `SELECT ar.*, u.full_name AS approver_user_name
     FROM approval_rules ar
     LEFT JOIN users u ON u.id = ar.approver_user_id
     WHERE ar.company_id = $1 ORDER BY ar.trigger_type, ar.sort_order`,
    [req.companyId]
  );
  res.json({ rules: result.rows });
}

async function createRule(req, res) {
  const { trigger_type, threshold_type, threshold_value, approver_role_code, approver_user_id } = req.body;
  if (!trigger_type) {
    return res.status(400).json({ error: 'trigger_type is required.' });
  }
  const sortResult = await pool.query(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM approval_rules WHERE company_id = $1`,
    [req.companyId]
  );
  const result = await pool.query(
    `INSERT INTO approval_rules (company_id, trigger_type, threshold_type, threshold_value, approver_role_code, approver_user_id, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      req.companyId, trigger_type, threshold_type || null, threshold_value || null,
      approver_role_code || null, approver_user_id || null, sortResult.rows[0].next,
    ]
  );
  res.status(201).json({ rule: { id: result.rows[0].id } });
}

async function updateRule(req, res) {
  const fields = {};
  for (const f of ['threshold_type', 'threshold_value', 'approver_role_code', 'approver_user_id', 'is_active']) {
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

// Only Admin/Management can approve or reject — this mirrors the same
// elevated-role check used for row visibility (visibility.js).
async function approveSalesOrder(req, res) {
  if (!isElevated(req)) {
    return res.status(403).json({ error: 'Only Admin/Management can approve contracts.' });
  }
  const result = await pool.query(
    `UPDATE sales_orders SET status = 'APPROVED' WHERE id = $1 AND company_id = $2 AND status = 'PENDING_APPROVAL' RETURNING id`,
    [req.params.id, req.companyId]
  );
  if (!result.rows[0]) {
    return res.status(400).json({ error: 'Contract is not pending approval.' });
  }
  await pool.query(
    `INSERT INTO approval_log (sales_order_id, action, actor_user_id, notes) VALUES ($1, 'APPROVED', $2, $3)`,
    [req.params.id, req.userId, req.body.notes || null]
  );
  res.json({ success: true });
}

async function rejectSalesOrder(req, res) {
  if (!isElevated(req)) {
    return res.status(403).json({ error: 'Only Admin/Management can reject contracts.' });
  }
  const result = await pool.query(
    `UPDATE sales_orders SET status = 'DRAFT' WHERE id = $1 AND company_id = $2 AND status = 'PENDING_APPROVAL' RETURNING id`,
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

module.exports = { listRules, createRule, updateRule, deleteRule, listApprovalLog, approveSalesOrder, rejectSalesOrder };
