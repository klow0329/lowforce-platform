const { pool } = require('../config/db');

// Budget/LE/Actual P&L — skeleton first pass. One budget per event.
// Revenue lines' Actual is computed from real contracted/invoiced data;
// Expense lines' Actual is computed from the actual_expense_entries ledger
// Finance imports into — never stored, always live, same idea as the
// reference Excel's own SUMIF-against-a-ledger design (see
// budget-pl-module-plan memory for the full mapping this was built from).
//
// KNOWN SIMPLIFICATION: the reference Excel distinguishes "invoiced
// portion at the real invoice rate" from "contracted-but-not-invoiced at
// today's system rate" for Actual Revenue. The current schema doesn't tie
// invoices to individual line items (invoicing happens at the whole-
// contract level), so that distinction isn't computable per revenue line
// yet — this uses each contract's own saved exchange_rate for all of its
// line items instead. Flagged to the user; not silently glossed over.

async function getBudgetSettings(req) {
  const result = await pool.query(
    `SELECT budget_preparer_user_id, budget_approver_user_id FROM company_settings WHERE company_id = $1`,
    [req.companyId]
  );
  return result.rows[0] || {};
}

function canPrepare(req, settings) {
  return req.roleCode === 'ADM' || (settings.budget_preparer_user_id && settings.budget_preparer_user_id === req.userId);
}

function canApprove(req, settings) {
  return req.roleCode === 'ADM' || (settings.budget_approver_user_id && settings.budget_approver_user_id === req.userId);
}

async function computeActuals(companyId, eventId, lines) {
  const revenueCodes = [...new Set(lines.filter((l) => l.line_type === 'REVENUE' && l.sales_item_code).map((l) => l.sales_item_code))];
  const expenseCodeIds = [...new Set(lines.filter((l) => l.line_type === 'EXPENSE' && l.expense_code_id).map((l) => l.expense_code_id))];

  const revenueByCode = {};
  if (revenueCodes.length > 0) {
    const result = await pool.query(
      `SELECT soi.sales_item_code, SUM((soi.subtotal - soi.discount_amount) * so.exchange_rate) AS actual
       FROM sales_order_items soi
       JOIN sales_orders so ON so.id = soi.sales_order_id
       WHERE so.company_id = $1 AND so.event_id = $2 AND so.is_active = TRUE AND so.status = 'APPROVED'
         AND soi.sales_item_code = ANY($3)
       GROUP BY soi.sales_item_code`,
      [companyId, eventId, revenueCodes]
    );
    for (const row of result.rows) revenueByCode[row.sales_item_code] = Number(row.actual);
  }

  const expenseByCodeId = {};
  if (expenseCodeIds.length > 0) {
    const result = await pool.query(
      `SELECT expense_code_id, SUM(amount) AS total
       FROM actual_expense_entries
       WHERE company_id = $1 AND event_id = $2 AND expense_code_id = ANY($3)
       GROUP BY expense_code_id`,
      [companyId, eventId, expenseCodeIds]
    );
    for (const row of result.rows) expenseByCodeId[row.expense_code_id] = -Number(row.total);
  }

  return lines.map((l) => ({
    ...l,
    actual_amount: l.line_type === 'REVENUE'
      ? (revenueByCode[l.sales_item_code] || 0)
      : (expenseByCodeId[l.expense_code_id] || 0),
  }));
}

async function getBudget(req, res) {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required.' });

  const budgetResult = await pool.query(
    `SELECT b.*, up.full_name AS preparer_name, ua.full_name AS approver_name
     FROM budgets b
     LEFT JOIN users up ON up.id = b.preparer_user_id
     LEFT JOIN users ua ON ua.id = b.approver_user_id
     WHERE b.company_id = $1 AND b.event_id = $2`,
    [req.companyId, event_id]
  );
  const budget = budgetResult.rows[0];
  if (!budget) return res.json({ budget: null });

  const linesResult = await pool.query(
    `SELECT bl.*, ec.code AS expense_code, ec.description AS expense_code_description
     FROM budget_lines bl
     LEFT JOIN expense_codes ec ON ec.id = bl.expense_code_id
     WHERE bl.budget_id = $1
     ORDER BY bl.line_type DESC, bl.sort_order, bl.description`,
    [budget.id]
  );
  const lines = await computeActuals(req.companyId, event_id, linesResult.rows);

  res.json({ budget, lines });
}

async function createBudget(req, res) {
  const { event_id } = req.body;
  if (!event_id) return res.status(400).json({ error: 'event_id is required.' });

  const settings = await getBudgetSettings(req);
  if (!canPrepare(req, settings)) {
    return res.status(403).json({ error: 'Only the designated Budget preparer or Admin can start a budget.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO budgets (company_id, event_id, preparer_user_id) VALUES ($1, $2, $3) RETURNING id`,
      [req.companyId, event_id, req.userId]
    );
    res.status(201).json({ budget: { id: result.rows[0].id } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A budget already exists for this event.' });
    throw err;
  }
}

async function requireBudgetAccess(req, res, checkFn) {
  const budgetResult = await pool.query(`SELECT * FROM budgets WHERE id = $1 AND company_id = $2`, [req.params.id, req.companyId]);
  const budget = budgetResult.rows[0];
  if (!budget) { res.status(404).json({ error: 'Budget not found.' }); return null; }
  const settings = await getBudgetSettings(req);
  if (!checkFn(req, settings)) { res.status(403).json({ error: 'Not authorized for this action.' }); return null; }
  return budget;
}

async function addBudgetLine(req, res) {
  const budget = await requireBudgetAccess(req, res, canPrepare);
  if (!budget) return;
  if (budget.status !== 'DRAFT') return res.status(400).json({ error: 'Budget lines can only be added while the budget is still Draft.' });

  const { line_type, section, sales_item_code, expense_code_id, description, budget_amount, comments } = req.body;
  if (!line_type || !section || !description) {
    return res.status(400).json({ error: 'line_type, section and description are required.' });
  }
  const result = await pool.query(
    `INSERT INTO budget_lines (budget_id, line_type, section, sales_item_code, expense_code_id, description, budget_amount, le_amount, comments)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8) RETURNING id`,
    [budget.id, line_type, section, sales_item_code || null, expense_code_id || null, description, budget_amount || 0, comments || null]
  );
  res.status(201).json({ line: { id: result.rows[0].id } });
}

async function updateBudgetLine(req, res) {
  const budgetResult = await pool.query(
    `SELECT b.* FROM budgets b JOIN budget_lines bl ON bl.budget_id = b.id
     WHERE bl.id = $1 AND b.company_id = $2`,
    [req.params.lineId, req.companyId]
  );
  const budget = budgetResult.rows[0];
  if (!budget) return res.status(404).json({ error: 'Budget line not found.' });

  const settings = await getBudgetSettings(req);
  const isPreparer = canPrepare(req, settings);
  const isApprover = canApprove(req, settings);
  if (!isPreparer && !isApprover) return res.status(403).json({ error: 'Not authorized for this action.' });

  const fields = {};
  // Once the budget is Approved, the original Budget figure is fixed —
  // only LE and Comments move from here on, matching the user's own
  // "once approved, it will be fixed, changes go in LE" description.
  const editable = budget.status === 'APPROVED' ? ['le_amount', 'comments'] : ['description', 'budget_amount', 'le_amount', 'comments', 'sort_order'];
  for (const f of editable) {
    if (f in req.body) fields[f] = req.body[f];
  }
  const cols = Object.keys(fields);
  if (cols.length === 0) return res.json({ line: { id: req.params.lineId } });
  const setClause = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  await pool.query(`UPDATE budget_lines SET ${setClause} WHERE id = $1`, [req.params.lineId, ...cols.map((c) => fields[c])]);
  res.json({ line: { id: req.params.lineId } });
}

async function deleteBudgetLine(req, res) {
  const budgetResult = await pool.query(
    `SELECT b.* FROM budgets b JOIN budget_lines bl ON bl.budget_id = b.id
     WHERE bl.id = $1 AND b.company_id = $2`,
    [req.params.lineId, req.companyId]
  );
  const budget = budgetResult.rows[0];
  if (!budget) return res.status(404).json({ error: 'Budget line not found.' });
  if (budget.status !== 'DRAFT') return res.status(400).json({ error: 'Budget lines can only be removed while the budget is still Draft.' });

  const settings = await getBudgetSettings(req);
  if (!canPrepare(req, settings)) return res.status(403).json({ error: 'Not authorized for this action.' });

  await pool.query(`DELETE FROM budget_lines WHERE id = $1`, [req.params.lineId]);
  res.json({ success: true });
}

async function submitBudgetForApproval(req, res) {
  const budget = await requireBudgetAccess(req, res, canPrepare);
  if (!budget) return;
  if (budget.status !== 'DRAFT') return res.status(400).json({ error: 'Budget is not in Draft status.' });
  await pool.query(`UPDATE budgets SET status = 'PENDING_APPROVAL', submitted_at = now() WHERE id = $1`, [budget.id]);
  res.json({ success: true });
}

async function approveBudget(req, res) {
  const budget = await requireBudgetAccess(req, res, canApprove);
  if (!budget) return;
  if (budget.status !== 'PENDING_APPROVAL') return res.status(400).json({ error: 'Budget is not pending approval.' });
  await pool.query(
    `UPDATE budgets SET status = 'APPROVED', approver_user_id = $2, approved_at = now() WHERE id = $1`,
    [budget.id, req.userId]
  );
  res.json({ success: true });
}

async function rejectBudget(req, res) {
  const budget = await requireBudgetAccess(req, res, canApprove);
  if (!budget) return;
  if (budget.status !== 'PENDING_APPROVAL') return res.status(400).json({ error: 'Budget is not pending approval.' });
  await pool.query(`UPDATE budgets SET status = 'DRAFT' WHERE id = $1`, [budget.id]);
  res.json({ success: true });
}

// ---------------------------------------------------------------------------
// Actual expense ledger — Finance's import target. Kept simple (one row at
// a time) for the skeleton; a bulk CSV import is the natural next step once
// this shape is confirmed to work.
// ---------------------------------------------------------------------------
async function listActualExpenseEntries(req, res) {
  const { event_id, expense_code_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required.' });
  const result = await pool.query(
    `SELECT e.*, ec.code AS expense_code, ec.description AS expense_code_description, u.full_name AS created_by_name
     FROM actual_expense_entries e
     JOIN expense_codes ec ON ec.id = e.expense_code_id
     LEFT JOIN users u ON u.id = e.created_by_user_id
     WHERE e.company_id = $1 AND e.event_id = $2
       AND ($3::uuid IS NULL OR e.expense_code_id = $3)
     ORDER BY e.entry_date DESC NULLS LAST, e.created_at DESC`,
    [req.companyId, event_id, expense_code_id || null]
  );
  res.json({ entries: result.rows });
}

async function createActualExpenseEntry(req, res) {
  const { event_id, expense_code_id, entry_date, reference, description, amount } = req.body;
  if (!event_id || !expense_code_id || amount === undefined) {
    return res.status(400).json({ error: 'event_id, expense_code_id and amount are required.' });
  }
  const result = await pool.query(
    `INSERT INTO actual_expense_entries (company_id, event_id, expense_code_id, entry_date, reference, description, amount, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [req.companyId, event_id, expense_code_id, entry_date || null, reference || null, description || null, amount, req.userId]
  );
  res.status(201).json({ entry: { id: result.rows[0].id } });
}

// Lets Management re-code an entry that was wrongly allocated, straight
// from the drill-down — the one write this ledger allows besides Finance's
// own import.
async function updateActualExpenseEntry(req, res) {
  const { expense_code_id } = req.body;
  if (!expense_code_id) return res.status(400).json({ error: 'expense_code_id is required.' });
  const result = await pool.query(
    `UPDATE actual_expense_entries SET expense_code_id = $1 WHERE id = $2 AND company_id = $3 RETURNING id`,
    [expense_code_id, req.params.id, req.companyId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Entry not found.' });
  res.json({ entry: { id: req.params.id } });
}

module.exports = {
  getBudget, createBudget,
  addBudgetLine, updateBudgetLine, deleteBudgetLine,
  submitBudgetForApproval, approveBudget, rejectBudget,
  listActualExpenseEntries, createActualExpenseEntry, updateActualExpenseEntry,
};
