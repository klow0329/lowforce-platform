// Row-level visibility by salesperson: Admin/Management see everything;
// everyone else sees only records assigned to them, plus unassigned ones
// (so a lead nobody has claimed yet is visible to the whole sales team).
// Applies to reads only (list/detail) — write access isn't restricted here.
const ELEVATED_ROLES = ['ADM', 'MGT'];

function isElevated(req) {
  return ELEVATED_ROLES.includes(req.roleCode);
}

// columnExpr: the salesperson_id column reference, e.g. 'o.salesperson_id'.
// paramIndex: the next available $N placeholder position in the query.
// Returns { sql, param } — splice sql into the WHERE clause; push param
// (if defined) into the query's parameter array at that position.
function visibilityClause(req, columnExpr, paramIndex) {
  if (isElevated(req)) return { sql: 'TRUE', param: undefined };
  return { sql: `(${columnExpr} = $${paramIndex} OR ${columnExpr} IS NULL)`, param: req.userId };
}

// Finance needs to see every invoice/payment/AR record company-wide to do
// their actual job (confirm any invoice, chase any customer's balance) —
// but that's narrower than full isElevated (Finance still shouldn't get
// Admin/Management's blanket visibility into Opportunities/Contracts, or
// contract-approval rights). A separate clause, used only on
// invoice/payment/aging queries, rather than adding FIN to ELEVATED_ROLES.
const FINANCE_VISIBLE_ROLES = ['ADM', 'MGT', 'FIN'];

function financeVisibilityClause(req, columnExpr, paramIndex) {
  if (FINANCE_VISIBLE_ROLES.includes(req.roleCode)) return { sql: 'TRUE', param: undefined };
  return { sql: `(${columnExpr} = $${paramIndex} OR ${columnExpr} IS NULL)`, param: req.userId };
}

module.exports = { isElevated, visibilityClause, financeVisibilityClause };
