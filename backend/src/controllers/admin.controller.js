const crypto = require('crypto');
const { pool } = require('../config/db');
const { hashPassword } = require('../utils/password');
const { passwordPolicyError, generateStrongPassword } = require('../utils/passwordPolicy');
const { cleanText, cleanLower } = require('../utils/importNormalize');
const { fillTemplate, DEFAULT_PASSWORD_RESET_SUBJECT, DEFAULT_PASSWORD_RESET_BODY } = require('../utils/emailTemplate');
const { sendMail } = require('../utils/mailer');

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
async function listUsers(req, res) {
  const result = await pool.query(
    `SELECT u.id, u.email, u.full_name, u.is_active, u.role_id, u.access_level_override, r.code AS role_code, r.name AS role_name,
            COALESCE(
              (SELECT array_agg(uea.event_id) FROM user_event_access uea
               WHERE uea.user_id = u.id AND uea.is_active = TRUE),
              '{}'
            ) AS event_ids,
            COALESCE(
              (SELECT jsonb_agg(jsonb_build_object('id', ur_r.id, 'code', ur_r.code, 'name', ur_r.name) ORDER BY ur_r.sort_order)
               FROM user_roles ur JOIN roles ur_r ON ur_r.id = ur.role_id
               WHERE ur.user_id = u.id),
              '[]'
            ) AS assigned_roles
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.company_id = $1
     ORDER BY u.full_name`,
    [req.companyId]
  );
  res.json({ users: result.rows });
}

// Replaces a user's full set of switchable roles. The primary role_id is
// always kept in the set — you can't remove someone's default role from
// here, only add/remove the extra ones they can switch into.
async function setUserRoles(req, res) {
  const { role_ids } = req.body;
  if (!Array.isArray(role_ids)) {
    return res.status(400).json({ error: 'role_ids must be an array.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userCheck = await client.query(
      `SELECT role_id FROM users WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.companyId]
    );
    if (!userCheck.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found.' });
    }
    const primaryRoleId = userCheck.rows[0].role_id;
    const finalRoleIds = Array.from(new Set([primaryRoleId, ...role_ids].filter(Boolean)));

    await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [req.params.id]);
    for (const roleId of finalRoleIds) {
      await client.query(
        `INSERT INTO user_roles (user_id, role_id)
         SELECT $1, id FROM roles WHERE id = $2 AND company_id = $3`,
        [req.params.id, roleId, req.companyId]
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
  const policyError = passwordPolicyError(temp_password);
  if (policyError) return res.status(400).json({ error: policyError });

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

  // A new user's only assigned (switchable) role is their primary one —
  // Admin adds more later via setUserRoles if this person needs to switch
  // between roles (e.g. Admin + Finance).
  await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [result.rows[0].id, role_id]);

  res.status(201).json({ user: { id: result.rows[0].id } });
}

async function updateUser(req, res) {
  const fields = {};
  for (const field of ['full_name', 'role_id', 'is_active']) {
    if (field in req.body) fields[field] = req.body[field];
  }
  // '' from the "Default" option means "no override" — store as NULL so it
  // falls back to the Department matrix, not an empty-string CHECK violation.
  if ('access_level_override' in req.body) {
    fields.access_level_override = req.body.access_level_override || null;
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

  // Changing someone's primary role should always keep it in their
  // switchable set too, so they're never assigned a default role they
  // can't actually be "acting as".
  if (fields.role_id) {
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.id, fields.role_id]
    );
  }

  res.json({ user: { id: req.params.id } });
}

// System-generates the new password (rather than the admin typing one) and
// emails it to the user directly — 2026-08-05, per the user's own report
// that resetting a password showed a temp password on-screen but never
// actually emailed the person it belongs to. Falls back to showing the
// Admin the password on screen (same as before) if email isn't configured
// or the send fails, so this is never a dead end even without RESEND_API_KEY.
async function resetPassword(req, res) {
  const user = await pool.query(`SELECT email, full_name FROM users WHERE id = $1 AND company_id = $2`, [req.params.id, req.companyId]);
  if (!user.rows[0]) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const tempPassword = generateStrongPassword();
  const passwordHash = await hashPassword(tempPassword);
  const result = await pool.query(
    `UPDATE users SET password_hash = $1
     WHERE id = $2 AND company_id = $3
     RETURNING id`,
    [passwordHash, req.params.id, req.companyId]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const company = await pool.query(`SELECT name FROM companies WHERE id = $1`, [req.companyId]);
  const tpl = await pool.query(
    `SELECT subject, body FROM email_templates WHERE company_id = $1 AND template_key = 'PASSWORD_RESET'`,
    [req.companyId]
  );
  const vars = { full_name: user.rows[0].full_name, email: user.rows[0].email, temp_password: tempPassword, company_name: company.rows[0]?.name || '' };
  const subject = fillTemplate(tpl.rows[0]?.subject || DEFAULT_PASSWORD_RESET_SUBJECT, vars);
  const body = fillTemplate(tpl.rows[0]?.body || DEFAULT_PASSWORD_RESET_BODY, vars);
  const emailResult = await sendMail({ to: user.rows[0].email, subject, text: body });

  res.json({
    success: true,
    // Always returned, not just on email failure — a genuine fallback if
    // email isn't configured/fails, not a security leak (the Admin doing
    // this is already authorized to know it; they set it a moment ago).
    temp_password: tempPassword,
    email_sent: emailResult.sent,
    email_error: emailResult.sent ? null : emailResult.reason,
  });
}

// Bulk-create users from Admin > Data Import > Users. Add-only by design —
// an email that already exists is skipped, never silently reset (a wrong
// bulk-uploaded row could otherwise lock someone out of their own account).
// Every created user gets a freshly generated temp password (no third-party
// invite-link auth exists — standing rule #4, custom-built auth only); the
// response returns each one in plain text so the Admin doing the import can
// either hand it out directly ("temp_password" mode) or copy the drafted
// USER_INVITE email template with it filled in ("email_invite" mode) — both
// modes create the account identically, the mode only changes what the
// frontend shows the Admin afterwards.
function generateTempPassword() {
  return generateStrongPassword();
}

async function importUsers(req, res) {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (rows.length === 0) return res.status(400).json({ error: 'No rows to import.' });

  const roleResult = await pool.query(`SELECT id, code FROM roles WHERE company_id = $1`, [req.companyId]);
  const roleIdByCode = new Map(roleResult.rows.map((r) => [r.code.toUpperCase(), r.id]));

  const existingUserCount = await pool.query(`SELECT count(*) FROM users WHERE company_id = $1`, [req.companyId]);
  let noUsersYet = Number(existingUserCount.rows[0].count) === 0;

  const createdUsers = [];
  const skipped = [];

  for (const row of rows) {
    const email = cleanLower(row.email);
    const fullName = cleanText(row.full_name);
    let roleCode = cleanText(row.role_code);
    // A company can never end up with zero Admins after its first import —
    // whichever row lands first for a brand-new company is forced to ADM
    // regardless of what the sheet said, so there's always someone who can
    // actually manage the account afterward.
    if (noUsersYet) roleCode = 'ADM';
    if (!email || !fullName || !roleCode) {
      skipped.push({ email: email || '(blank)', reason: 'Missing email, full name, or role code.' });
      continue;
    }
    const roleId = roleIdByCode.get(roleCode);
    if (!roleId) {
      skipped.push({ email, reason: `Unknown role code "${roleCode}".` });
      continue;
    }
    const existing = await pool.query(
      `SELECT 1 FROM users WHERE company_id = $1 AND LOWER(email) = LOWER($2)`,
      [req.companyId, email]
    );
    if (existing.rows[0]) {
      skipped.push({ email, reason: 'A user with that email already exists — not overwritten.' });
      continue;
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    const result = await pool.query(
      `INSERT INTO users (company_id, role_id, email, password_hash, full_name)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.companyId, roleId, email, passwordHash, fullName]
    );
    noUsersYet = false;
    await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [result.rows[0].id, roleId]);
    createdUsers.push({ id: result.rows[0].id, email, full_name: fullName, role_code: roleCode, temp_password: tempPassword });
  }

  res.json({ success: true, created: createdUsers.length, createdUsers, skipped, rowsProcessed: rows.length });
}

// Actually sends the USER_INVITE template (vs. the "Copy Invite Email"
// clipboard fallback, which still works if SMTP isn't configured — see
// mailer.js). Only usable right after an import/reset where the caller
// still has the plaintext temp password in hand (never stored, so it can't
// be re-sent later without generating a new one).
async function sendUserInviteEmail(req, res) {
  const { email, full_name, temp_password } = req.body;
  if (!email || !full_name || !temp_password) {
    return res.status(400).json({ error: 'email, full_name, and temp_password are required.' });
  }
  const tplResult = await pool.query(
    `SELECT subject, body FROM email_templates WHERE company_id = $1 AND template_key = 'USER_INVITE'`,
    [req.companyId]
  );
  if (!tplResult.rows[0]) {
    return res.status(400).json({ error: 'No USER_INVITE template saved yet — set one up under Admin > Email Templates first.' });
  }
  const companyResult = await pool.query(`SELECT name FROM companies WHERE id = $1`, [req.companyId]);
  const senderResult = await pool.query(`SELECT full_name FROM users WHERE id = $1`, [req.userId]);
  const vars = {
    full_name, email, temp_password,
    company_name: companyResult.rows[0]?.name || '',
    sender_name: senderResult.rows[0]?.full_name || '',
  };
  const result = await sendMail({
    to: email,
    subject: fillTemplate(tplResult.rows[0].subject, vars),
    text: fillTemplate(tplResult.rows[0].body, vars),
  });
  if (!result.sent) {
    return res.status(503).json({ error: result.reason });
  }
  res.json({ success: true });
}

async function listRoles(req, res) {
  const result = await pool.query(
    `SELECT id, code, name, permissions FROM roles WHERE company_id = $1 ORDER BY sort_order`,
    [req.companyId]
  );
  res.json({ roles: result.rows });
}

// Company-defined departments/roles (standing rule #2 — not a fixed list).
// A brand-new role starts with NO module permissions set at all
// ({}), which the requireModulePermission middleware treats as
// "not managed by the new system" and falls through to whatever a route's
// own existing checks decide — same baseline access as any other
// non-elevated role until the admin explicitly grants module permissions
// below. code is a short stable identifier (matches req.roleCode from the
// session) and can't collide with an existing role in this company.
const MODULE_NAMES = ['exhibitors', 'opportunities', 'contracts', 'invoices'];
const PERMISSION_LEVELS = ['view', 'add', 'edit'];

function validatePermissions(permissions) {
  if (permissions == null) return {};
  if (typeof permissions !== 'object' || Array.isArray(permissions)) {
    throw Object.assign(new Error('permissions must be an object.'), { status: 400 });
  }
  const out = {};
  for (const [key, value] of Object.entries(permissions)) {
    if (!MODULE_NAMES.includes(key)) {
      throw Object.assign(new Error(`Unknown module "${key}".`), { status: 400 });
    }
    if (value !== null && !PERMISSION_LEVELS.includes(value)) {
      throw Object.assign(new Error(`Invalid permission level "${value}" for ${key}.`), { status: 400 });
    }
    if (value) out[key] = value;
  }
  return out;
}

async function createRole(req, res) {
  const { code, name, permissions } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'code and name are required.' });
  const normalizedCode = code.trim().toUpperCase().replace(/\s+/g, '_');

  let validatedPermissions;
  try {
    validatedPermissions = validatePermissions(permissions);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  const existing = await pool.query(`SELECT 1 FROM roles WHERE company_id = $1 AND code = $2`, [req.companyId, normalizedCode]);
  if (existing.rows[0]) return res.status(409).json({ error: `A role with code "${normalizedCode}" already exists.` });

  const sortResult = await pool.query(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM roles WHERE company_id = $1`, [req.companyId]);
  const result = await pool.query(
    `INSERT INTO roles (company_id, code, name, permissions, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [req.companyId, normalizedCode, name.trim(), JSON.stringify(validatedPermissions), sortResult.rows[0].next]
  );
  res.status(201).json({ role: { id: result.rows[0].id } });
}

async function updateRole(req, res) {
  const fields = {};
  if ('name' in req.body) fields.name = req.body.name;
  if ('permissions' in req.body) {
    try {
      fields.permissions = JSON.stringify(validatePermissions(req.body.permissions));
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
  }
  const cols = Object.keys(fields);
  if (cols.length === 0) return res.json({ role: { id: req.params.id } });

  const setClause = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
  const result = await pool.query(
    `UPDATE roles SET ${setClause} WHERE id = $1 AND company_id = $2 RETURNING id`,
    [req.params.id, req.companyId, ...cols.map((c) => fields[c])]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Role not found.' });
  res.json({ role: { id: req.params.id } });
}

// Roles in active use (any user currently assigned it, via either the
// primary role_id or the switchable user_roles set) can't be deleted out
// from under them — reassign those users first.
async function deleteRole(req, res) {
  const inUse = await pool.query(
    `SELECT 1 FROM users WHERE company_id = $1 AND role_id = $2
     UNION SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.company_id = $1 AND ur.role_id = $2`,
    [req.companyId, req.params.id]
  );
  if (inUse.rows[0]) {
    return res.status(400).json({ error: 'This role is still assigned to at least one user — reassign them first.' });
  }
  const result = await pool.query(`DELETE FROM roles WHERE id = $1 AND company_id = $2 RETURNING id`, [req.params.id, req.companyId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Role not found.' });
  res.json({ success: true });
}

// ---------------------------------------------------------------------------
// Events — unlike /api/reference/events, this includes inactive ones
// ---------------------------------------------------------------------------
async function listEvents(req, res) {
  const result = await pool.query(
    `SELECT e.id, e.code, e.name, e.event_year, e.start_date, e.end_date, e.is_active,
            e.parent_event_id, p.code AS parent_code, e.tier, e.venue, (e.logo_filename IS NOT NULL) AS has_logo
     FROM events e
     LEFT JOIN events p ON p.id = e.parent_event_id
     WHERE e.company_id = $1
     ORDER BY e.event_year DESC, e.code`,
    [req.companyId]
  );
  res.json({ events: result.rows });
}

// Enforces the hierarchy shape: MAIN has no parent; EDITION's parent (if
// any) must be a MAIN. Postgres CHECK constraints can't see a sibling
// row's tier, so this lives here rather than in the schema. A third tier
// (CATEGORY, "a sub-event within an Edition") existed briefly but was
// superseded same-day by the event_categories table ("Sub-event" in the
// UI) — see migration 089.
async function validateEventTier(companyId, tier, parentEventId) {
  if (tier === 'MAIN') {
    if (parentEventId) return 'A Main event cannot have a parent.';
    return null;
  }
  if (!parentEventId) return null; // Edition with no Main yet — parent is optional
  const parent = await pool.query(`SELECT tier FROM events WHERE id = $1 AND company_id = $2`, [parentEventId, companyId]);
  if (!parent.rows[0]) return 'Parent event not found.';
  if (tier === 'EDITION' && parent.rows[0].tier !== 'MAIN') return "An Edition's parent must be a Main event.";
  return null;
}

async function createEvent(req, res) {
  const { code, name, event_year, start_date, end_date, parent_event_id, tier, venue } = req.body;

  if (!code || !name) {
    return res.status(400).json({ error: 'code and name are required.' });
  }
  const eventTier = tier || 'EDITION';
  const tierError = await validateEventTier(req.companyId, eventTier, parent_event_id || null);
  if (tierError) return res.status(400).json({ error: tierError });

  const duplicate = await pool.query(
    `SELECT 1 FROM events WHERE company_id = $1 AND code = $2`,
    [req.companyId, code]
  );
  if (duplicate.rows[0]) {
    return res.status(409).json({ error: 'An event with that code already exists.' });
  }

  const result = await pool.query(
    `INSERT INTO events (company_id, code, name, event_year, start_date, end_date, parent_event_id, tier, venue)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [req.companyId, code, name, event_year || null, start_date || null, end_date || null, parent_event_id || null, eventTier, venue || null]
  );

  res.status(201).json({ event: { id: result.rows[0].id } });
}

// Event code stays immutable after creation — it's the stable identifier
// data entry and reports hang off; rename via `name` instead. Tier is also
// immutable after creation (changing it mid-life would strand child events
// against an invalid hierarchy) — recreate the event if the tier was wrong.
async function updateEvent(req, res) {
  const fields = {};
  for (const field of ['name', 'event_year', 'start_date', 'end_date', 'is_active', 'parent_event_id', 'venue']) {
    if (field in req.body) fields[field] = req.body[field] === '' ? null : req.body[field];
  }
  // an event can't be its own parent
  if (fields.parent_event_id === req.params.id) {
    return res.status(400).json({ error: "An event can't be its own parent." });
  }
  if ('parent_event_id' in fields) {
    const current = await pool.query(`SELECT tier FROM events WHERE id = $1 AND company_id = $2`, [req.params.id, req.companyId]);
    if (!current.rows[0]) return res.status(404).json({ error: 'Event not found.' });
    const tierError = await validateEventTier(req.companyId, current.rows[0].tier, fields.parent_event_id);
    if (tierError) return res.status(400).json({ error: tierError });
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

// ---------------------------------------------------------------------------
// Event Categories ("sub-events" — 2026-08-05) — reusable, year-independent
// tags scoped to a Main (e.g. "MYFT", "MCE" under "MIFB"), applied per
// participation/contract rather than recreated as a new event every year.
// Company-configurable, standing rule #2 — a second company's sub-event
// names have nothing to do with ExpoCO's.
// ---------------------------------------------------------------------------
async function listEventCategories(req, res) {
  const result = await pool.query(
    `SELECT ec.id, ec.main_event_id, m.code AS main_event_code, ec.code, ec.name, ec.is_active, ec.sort_order
     FROM event_categories ec
     JOIN events m ON m.id = ec.main_event_id
     WHERE ec.company_id = $1
     ORDER BY m.code, ec.sort_order, ec.code`,
    [req.companyId]
  );
  res.json({ eventCategories: result.rows });
}

async function createEventCategory(req, res) {
  const { main_event_id, code, name } = req.body;
  if (!main_event_id || !code || !name) {
    return res.status(400).json({ error: 'main_event_id, code and name are required.' });
  }
  const main = await pool.query(`SELECT tier FROM events WHERE id = $1 AND company_id = $2`, [main_event_id, req.companyId]);
  if (!main.rows[0] || main.rows[0].tier !== 'MAIN') {
    return res.status(400).json({ error: 'main_event_id must reference a Main event.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO event_categories (company_id, main_event_id, code, name) VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.companyId, main_event_id, code.trim().toUpperCase(), name.trim()]
    );
    res.status(201).json({ eventCategory: { id: result.rows[0].id } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `"${code}" already exists under this Main event.` });
    throw err;
  }
}

async function updateEventCategory(req, res) {
  const fields = {};
  for (const f of ['code', 'name', 'is_active', 'sort_order']) {
    if (f in req.body) fields[f] = f === 'code' ? String(req.body[f]).trim().toUpperCase() : req.body[f];
  }
  const cols = Object.keys(fields);
  if (cols.length === 0) return res.json({ eventCategory: { id: req.params.id } });
  const setClause = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
  try {
    const result = await pool.query(
      `UPDATE event_categories SET ${setClause} WHERE id = $1 AND company_id = $2 RETURNING id`,
      [req.params.id, req.companyId, ...cols.map((c) => fields[c])]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Sub-event not found.' });
    res.json({ eventCategory: { id: req.params.id } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That code already exists under this Main event.' });
    throw err;
  }
}

module.exports = {
  listUsers, createUser, importUsers, sendUserInviteEmail, updateUser, resetPassword, listRoles, setUserEventAccess, setUserRoles,
  createRole, updateRole, deleteRole, MODULE_NAMES, PERMISSION_LEVELS,
  listEvents, createEvent, updateEvent,
  listEventCategories, createEventCategory, updateEventCategory,
};
