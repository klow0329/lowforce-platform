const { pool } = require('../config/db');

// Per-event access control (plan Section 1: a user's access is scoped within
// their company). Admin and Management see every event; everyone else only
// the events they've been granted in user_event_access — same model as
// tblUserEventAccess in the old Power Apps design.
//
// A grant cascades DOWN the full events hierarchy, not just one level — a
// grant on a Main (e.g. "MIFB") reaches every Edition under it (MIFB26,
// MIFB27, ...) and every Category under each Edition (MCE26, MYFT26, ...),
// per the user's explicit 2026-08-05 instruction that Main-level user
// access should be automatic across everything beneath it. Originally this
// only walked one parent_event_id hop (correct for the old 2-tier
// Main->Sub-event shape); the recursive CTE below generalizes it so a grant
// at any tier reaches every descendant at any depth, not a hardcoded count.
const ANCESTOR_CTE = `
  WITH RECURSIVE event_ancestors AS (
    SELECT id AS event_id, id AS ancestor_id FROM events WHERE company_id = $2
    UNION ALL
    SELECT ea.event_id, ev.parent_event_id
    FROM event_ancestors ea
    JOIN events ev ON ev.id = ea.ancestor_id
    WHERE ev.parent_event_id IS NOT NULL
  )
`;

async function userCanAccessEvent(userId, companyId, eventId) {
  const result = await pool.query(
    `${ANCESTOR_CTE}
     SELECT 1
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.company_id = $2
       AND (
         r.code IN ('ADM', 'MGT')
         OR EXISTS (
           SELECT 1 FROM event_ancestors ea
           JOIN user_event_access uea ON uea.event_id = ea.ancestor_id
           WHERE ea.event_id = $3 AND uea.user_id = u.id AND uea.is_active = TRUE
         )
       )`,
    [userId, companyId, eventId]
  );
  return !!result.rows[0];
}

// Route middleware: if the request names an event (query or body), verify the
// logged-in user can access it. Runs after attachTenant.
function requireEventAccess(req, res, next) {
  const eventId = req.query.event_id || (req.body && req.body.event_id);
  if (!eventId) return next();

  userCanAccessEvent(req.userId, req.companyId, eventId)
    .then((ok) => {
      if (!ok) return res.status(403).json({ error: 'You do not have access to this event.' });
      next();
    })
    .catch(next);
}

// All event ids this user can see — used when replacing per-exhibitor event
// participation so a user never wipes grants on events they can't even see.
async function getAccessibleEventIds(userId, companyId) {
  const result = await pool.query(
    `${ANCESTOR_CTE}
     SELECT DISTINCT e.id FROM events e
     WHERE e.company_id = $2
       AND (
         EXISTS (SELECT 1 FROM users u LEFT JOIN roles r ON r.id = u.role_id
                 WHERE u.id = $1 AND r.code IN ('ADM','MGT'))
         OR EXISTS (
           SELECT 1 FROM event_ancestors ea
           JOIN user_event_access uea ON uea.event_id = ea.ancestor_id
           WHERE ea.event_id = e.id AND uea.user_id = $1 AND uea.is_active = TRUE
         )
       )`,
    [userId, companyId]
  );
  return result.rows.map((r) => r.id);
}

module.exports = { userCanAccessEvent, requireEventAccess, getAccessibleEventIds };
