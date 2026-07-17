const { pool } = require('../config/db');

// Per-event access control (plan Section 1: a user's access is scoped within
// their company). Admin and Management see every event; everyone else only
// the events they've been granted in user_event_access — same model as
// tblUserEventAccess in the old Power Apps design.
async function userCanAccessEvent(userId, companyId, eventId) {
  const result = await pool.query(
    `SELECT 1
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.company_id = $2
       AND (
         r.code IN ('ADM', 'MGT')
         OR EXISTS (
           SELECT 1 FROM user_event_access uea
           WHERE uea.user_id = u.id AND uea.event_id = $3 AND uea.is_active = TRUE
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
    `SELECT e.id FROM events e
     WHERE e.company_id = $2
       AND (
         EXISTS (SELECT 1 FROM users u LEFT JOIN roles r ON r.id = u.role_id
                 WHERE u.id = $1 AND r.code IN ('ADM','MGT'))
         OR EXISTS (SELECT 1 FROM user_event_access uea
                    WHERE uea.user_id = $1 AND uea.event_id = e.id AND uea.is_active = TRUE)
       )`,
    [userId, companyId]
  );
  return result.rows.map((r) => r.id);
}

module.exports = { userCanAccessEvent, requireEventAccess, getAccessibleEventIds };
