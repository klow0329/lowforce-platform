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

module.exports = { isElevated, visibilityClause };
