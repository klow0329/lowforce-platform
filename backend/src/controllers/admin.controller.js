const { pool } = require('../config/db');
const { hashPassword } = require('../utils/password');

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
async function listUsers(req, res) {
  const result = await pool.query(
    `SELECT u.id, u.email, u.full_name, u.is_active, u.role_id, r.code AS role_code, r.name AS role_name,
            COALESCE(
              (SELECT array_agg(uea.event_id) FROM user_event_access uea
               WHERE uea.user_id = u.id AND uea.is_active = TRUE),
              '{}'
            ) AS event_ids
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.company_id = $1
     ORDER BY u.full_name`,
    [req.companyId]
  );
  res.json({ users: result.rows });
}

// Replaces a user's full event-access set in one call. Admin/Management see
// all events regardless (see middleware/eventAccess.js), so grants only
// matter for other roles.
async function setUserEventAccess(req, res) {
  const { event_ids } = req.body;
  if (!Array.isArray(event_ids)) {
    return res.status(400).json({ error: 'event_ids must be an array.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userCheck = await client.query(
      `SELECT 1 FROM users WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.companyId]
    );
    if (!userCheck.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found.' });
    }

    await client.query(`DELETE FROM user_event_access WHERE user_id = $1`, [req.params.id]);
    for (const eventId of event_ids) {
      await client.query(
        `INSERT INTO user_event_access (user_id, event_id)
         SELECT $1, id FROM events WHERE id = $2 AND company_id = $3`,
        [req.params.id, eventId, req.companyId]
      );
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

async function createUser(req, res) {
  const { email, full_name, role_id, temp_password } = req.body;

  if (!email || !full_name || !role_id || !temp_password) {
    return res.status(400).json({ error: 'email, full_name, role_id and temp_password are required.' });
  }
  if (temp_password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const duplicate = await pool.query(
    `SELECT 1 FROM users WHERE company_id = $1 AND LOWER(email) = LOWER($2)`,
    [req.companyId, email]
  );
  if (duplicate.rows[0]) {
    return res.status(409).json({ error: 'A user with that email already exists.' });
  }

  const passwordHash = await hashPassword(temp_password);
  const result = await pool.query(
    `INSERT INTO users (company_id, role_id, email, password_hash, full_name)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [req.companyId, role_id, email, passwordHash, full_name]
  );

  res.status(201).json({ user: { id: result.rows[0].id } });
}

async function updateUser(req, res) {
  const fields = {};
  for (const field of ['full_name', 'role_id', 'is_active']) {
    if (field in req.body) fields[field] = req.body[field];
  }
  const columns = Object.keys(fields);

  if (columns.length === 0) {
    return res.json({ user: { id: req.params.id } });
  }

  // Admin-lockout guard: you can't deactivate your own account, otherwise a
  // sole admin could lock the whole company out of the Admin module.
  if (fields.is_active === false && req.params.id === req.userId) {
    return res.status(400).json({ error: "You can't deactivate your own account." });
  }

  const setClause = columns.map((c, i) => `${c} = $${i + 3}`).join(', ');
  const result = await pool.query(
    `UPDATE users SET ${setClause}
     WHERE id = $1 AND company_id = $2
     RETURNING id`,
    [req.params.id, req.companyId, ...columns.map((c) => fields[c])]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: 'User not found.' });
  }

  res.json({ user: { id: req.params.id } });
}

async function resetPassword(req, res) {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const passwordHash = await hashPassword(new_password);
  const result = await pool.query(
    `UPDATE users SET password_hash = $1
     WHERE id = $2 AND company_id = $3
     RETURNING id`,
    [passwordHash, req.params.id, req.companyId]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: 'User not found.' });
  }

  res.json({ success: true });
}

async function listRoles(req, res) {
  const result = await pool.query(
    `SELECT id, code, name FROM roles WHERE company_id = $1 ORDER BY sort_order`,
    [req.companyId]
  );
  res.json({ roles: result.rows });
}

// ---------------------------------------------------------------------------
// Events — unlike /api/reference/events, this includes inactive ones
// ---------------------------------------------------------------------------
async function listEvents(req, res) {
  const result = await pool.query(
    `SELECT id, code, name, event_year, start_date, end_date, is_active
     FROM events WHERE company_id = $1
     ORDER BY event_year DESC, code`,
    [req.companyId]
  );
  res.json({ events: result.rows });
}

async function createEvent(req, res) {
  const { code, name, event_year, start_date, end_date } = req.body;

  if (!code || !name) {
    return res.status(400).json({ error: 'code and name are required.' });
  }

  const duplicate = await pool.query(
    `SELECT 1 FROM events WHERE company_id = $1 AND code = $2`,
    [req.companyId, code]
  );
  if (duplicate.rows[0]) {
    return res.status(409).json({ error: 'An event with that code already exists.' });
  }

  const result = await pool.query(
    `INSERT INTO events (company_id, code, name, event_year, start_date, end_date)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [req.companyId, code, name, event_year || null, start_date || null, end_date || null]
  );

  res.status(201).json({ event: { id: result.rows[0].id } });
}

// Event code stays immutable after creation — it's the stable identifier
// data entry and reports hang off; rename via `name` instead.
async function updateEvent(req, res) {
  const fields = {};
  for (const field of ['name', 'event_year', 'start_date', 'end_date', 'is_active']) {
    if (field in req.body) fields[field] = req.body[field] === '' ? null : req.body[field];
  }
  const columns = Object.keys(fields);

  if (columns.length === 0) {
    return res.json({ event: { id: req.params.id } });
  }

  const setClause = columns.map((c, i) => `${c} = $${i + 3}`).join(', ');
  const result = await pool.query(
    `UPDATE events SET ${setClause}
     WHERE id = $1 AND company_id = $2
     RETURNING id`,
    [req.params.id, req.companyId, ...columns.map((c) => fields[c])]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: 'Event not found.' });
  }

  res.json({ event: { id: req.params.id } });
}

module.exports = {
  listUsers, createUser, updateUser, resetPassword, listRoles, setUserEventAccess,
  listEvents, createEvent, updateEvent,
};
