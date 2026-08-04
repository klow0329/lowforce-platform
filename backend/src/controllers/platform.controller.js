const { pool } = require('../config/db');
const { verifyPassword, hashPassword } = require('../utils/password');

// Platform actions are logged to their own table (see migration 081) —
// audit_log's company_id is NOT NULL, and these actions often have no
// company (creating a group) or act ON one rather than inside it. Never
// throws: an audit write failing must not block the operator's action, but
// it should be visible in the server log.
async function recordPlatformAudit(req, { action, entityType, entityId, companyId, details }) {
  try {
    const admin = req.platformAdmin || (req.session && req.session.platformAdmin) || {};
    await pool.query(
      `INSERT INTO platform_audit_log (platform_admin_id, admin_email, action, entity_type, entity_id, company_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [admin.id || null, admin.email || null, action, entityType || null, entityId || null, companyId || null,
        details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    console.warn('[platform-audit] failed to record', action, err.message);
  }
}

// ---------------------------------------------------------------------------
// Platform-owner console — the LowForce operator's own admin, outside any
// tenant. Every query here is deliberately NOT company-scoped (that's the
// whole point), which is exactly why the route file gates all of it behind
// requirePlatformAdmin and why the session key is separate from tenant auth.
// ---------------------------------------------------------------------------

async function platformLogin(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const result = await pool.query(
    `SELECT id, email, password_hash, full_name, is_active FROM platform_admins WHERE LOWER(email) = LOWER($1)`,
    [email]
  );
  const admin = result.rows[0];
  // Same generic message whether the email is unknown, the password is
  // wrong, or the account is disabled — this login is internet-facing and
  // shouldn't confirm which platform-operator emails exist.
  const invalid = () => res.status(401).json({ error: 'Invalid email or password.' });
  if (!admin || !admin.is_active) return invalid();
  if (!(await verifyPassword(password, admin.password_hash))) return invalid();

  // Never hold a tenant session and a platform session at the same time —
  // regenerate rather than merge, so there is no request that could be read
  // as both.
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Could not start session.' });
    req.session.platformAdmin = { id: admin.id, email: admin.email, full_name: admin.full_name };
    pool.query(`UPDATE platform_admins SET last_login_at = now() WHERE id = $1`, [admin.id]).catch(() => {});
    recordPlatformAudit(req, { action: 'LOGIN' });
    res.json({ platformAdmin: req.session.platformAdmin });
  });
}

function platformMe(req, res) {
  const admin = req.session && req.session.platformAdmin;
  res.json({ platformAdmin: admin || null });
}

function platformLogout(req, res) {
  if (!req.session) return res.json({ success: true });
  req.session.destroy(() => res.json({ success: true }));
}

// Self-service password change for the LOGGED-IN platform admin. If you
// forget it entirely (no session to change it from), the recovery path is
// re-running backend/scripts/create-platform-admin.js with the same email —
// it upserts on email, so it doubles as a reset.
async function platformChangePassword(req, res) {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current and new password are required.' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  const result = await pool.query(`SELECT password_hash FROM platform_admins WHERE id = $1`, [req.platformAdmin.id]);
  if (!(await verifyPassword(current_password, result.rows[0].password_hash))) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  const newHash = await hashPassword(new_password);
  await pool.query(`UPDATE platform_admins SET password_hash = $1 WHERE id = $2`, [newHash, req.platformAdmin.id]);
  await recordPlatformAudit(req, { action: 'PASSWORD_CHANGE' });
  res.json({ success: true });
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------
async function listGroups(req, res) {
  const result = await pool.query(
    `SELECT g.id, g.name, g.slug, g.reg_no, g.country_code, g.notes, g.parent_group_id,
            pg.name AS parent_group_name,
            (SELECT COUNT(*) FROM companies c WHERE c.group_id = g.id) AS company_count
     FROM groups g
     LEFT JOIN groups pg ON pg.id = g.parent_group_id
     ORDER BY g.name`
  );
  res.json({ groups: result.rows });
}

function slugify(name) {
  return String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function createGroup(req, res) {
  const { name, reg_no, country_code, notes, parent_group_id } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Group name is required.' });

  const slug = slugify(name);
  const dup = await pool.query(`SELECT 1 FROM groups WHERE slug = $1`, [slug]);
  if (dup.rows[0]) return res.status(409).json({ error: `A group with a similar name already exists ("${slug}").` });

  const result = await pool.query(
    `INSERT INTO groups (name, slug, reg_no, country_code, notes, parent_group_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [String(name).trim(), slug, reg_no || null, country_code || null, notes || null, parent_group_id || null]
  );
  await recordPlatformAudit(req, {
    action: 'GROUP_CREATE', entityType: 'group', entityId: result.rows[0].id,
    details: { name: String(name).trim(), reg_no: reg_no || null, parent_group_id: parent_group_id || null },
  });
  res.status(201).json({ group: { id: result.rows[0].id } });
}

const GROUP_FIELDS = ['name', 'reg_no', 'country_code', 'notes', 'parent_group_id'];
async function updateGroup(req, res) {
  const fields = {};
  for (const f of GROUP_FIELDS) if (f in req.body) fields[f] = req.body[f] === '' ? null : req.body[f];

  // A group cannot be its own parent, and cannot sit under one of its own
  // descendants — either would create a cycle that any future consolidated
  // roll-up would loop on forever.
  if (fields.parent_group_id) {
    if (fields.parent_group_id === req.params.id) {
      return res.status(400).json({ error: 'A group cannot be its own parent.' });
    }
    const cycle = await pool.query(
      `WITH RECURSIVE up AS (
         SELECT id, parent_group_id FROM groups WHERE id = $1
         UNION ALL
         SELECT g.id, g.parent_group_id FROM groups g JOIN up ON g.id = up.parent_group_id
       ) SELECT 1 FROM up WHERE id = $2`,
      [fields.parent_group_id, req.params.id]
    );
    if (cycle.rows[0]) {
      return res.status(400).json({ error: 'That would create a circular group structure.' });
    }
  }

  const cols = Object.keys(fields);
  if (cols.length === 0) return res.json({ group: { id: req.params.id } });
  const setClause = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const result = await pool.query(
    `UPDATE groups SET ${setClause} WHERE id = $1 RETURNING id`,
    [req.params.id, ...cols.map((c) => fields[c])]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Group not found.' });
  await recordPlatformAudit(req, { action: 'GROUP_UPDATE', entityType: 'group', entityId: req.params.id, details: { changed: fields } });
  res.json({ group: { id: req.params.id } });
}

// Refuses if any company is still linked, or any other group still has this
// one as its parent — both would otherwise orphan a live reference the
// moment this row disappeared. Unlink companies (via updateCompany's
// group_id) and reassign/detach child groups (via updateGroup's
// parent_group_id) first; only an empty, childless group can be deleted.
// No FK on groups from anything with its own audit trail, so a hard delete
// here (unlike companies) doesn't risk breaking one.
async function deleteGroup(req, res) {
  const group = await pool.query(`SELECT name FROM groups WHERE id = $1`, [req.params.id]);
  if (!group.rows[0]) return res.status(404).json({ error: 'Group not found.' });

  const companies = await pool.query(`SELECT COUNT(*) FROM companies WHERE group_id = $1`, [req.params.id]);
  if (Number(companies.rows[0].count) > 0) {
    return res.status(409).json({ error: 'This group still has companies linked to it. Move or unlink them first (edit each company\'s Group).' });
  }
  const children = await pool.query(`SELECT COUNT(*) FROM groups WHERE parent_group_id = $1`, [req.params.id]);
  if (Number(children.rows[0].count) > 0) {
    return res.status(409).json({ error: 'This group still has child groups under it. Reassign or detach them first.' });
  }

  await pool.query(`DELETE FROM groups WHERE id = $1`, [req.params.id]);
  await recordPlatformAudit(req, { action: 'GROUP_DELETE', entityType: 'group', entityId: req.params.id, details: { name: group.rows[0].name } });
  res.json({ success: true });
}

// ---------------------------------------------------------------------------
// Companies (tenants)
// ---------------------------------------------------------------------------
async function listCompanies(req, res) {
  const result = await pool.query(
    `SELECT c.id, c.name, c.slug, c.reg_no, c.country_code, c.notes, c.is_active, c.created_at, c.registered_at,
            c.group_id, g.name AS group_name, c.suspended_at, c.suspended_reason,
            (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.is_active) AS user_count,
            (SELECT COUNT(*) FROM events e WHERE e.company_id = c.id) AS event_count,
            (SELECT COUNT(*) FROM exhibitors e WHERE e.company_id = c.id AND e.is_active) AS exhibitor_count
     FROM companies c
     LEFT JOIN groups g ON g.id = c.group_id
     ORDER BY c.name`
  );
  res.json({ companies: result.rows });
}

// Registering a tenant creates the company AND the starter configuration
// every company needs to be usable at all (roles, pipeline stages, aging
// buckets). Without the ADM role in particular there'd be no role to give
// the company's first user, so the tenant would be dead on arrival.
// Same defaults as seed.sql / migration 076 — starting point, not fixed
// rules; each company edits its own afterwards (standing rule #2).
async function createCompany(req, res) {
  const { name, reg_no, country_code, notes, group_id } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Company name is required.' });

  const slug = slugify(name);
  const dup = await pool.query(`SELECT 1 FROM companies WHERE slug = $1`, [slug]);
  if (dup.rows[0]) return res.status(409).json({ error: `A company with a similar name already exists ("${slug}").` });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO companies (name, slug, reg_no, country_code, notes, group_id, registered_at)
       VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING id`,
      [String(name).trim(), slug, reg_no || null, country_code || null, notes || null, group_id || null]
    );
    const cid = inserted.rows[0].id;

    await client.query(
      `INSERT INTO roles (company_id, code, name, sort_order) VALUES
        ($1,'ADM','Admin',1), ($1,'MGT','Management',2), ($1,'SALES','Sales',3),
        ($1,'FIN','Finance',4), ($1,'OPS','Operations',5), ($1,'MKT','Marketing',6)
       ON CONFLICT (company_id, code) DO NOTHING`,
      [cid]
    );
    await client.query(
      `INSERT INTO sales_stages (company_id, code, name, probability_pct, sort_order, is_won, is_lost) VALUES
        ($1,'STG10','Initial Contact',10,1,FALSE,FALSE),
        ($1,'STG40','Proposal Sent',40,2,FALSE,FALSE),
        ($1,'STG80','Verbal Confirm',80,3,FALSE,FALSE),
        ($1,'WON','Won',100,4,TRUE,FALSE),
        ($1,'LOSE','Lost',0,5,FALSE,TRUE)
       ON CONFLICT (company_id, code) DO NOTHING`,
      [cid]
    );
    await client.query(
      `INSERT INTO aging_buckets (company_id, label, min_days, max_days, sort_order) VALUES
        ($1,'0-30 days',0,30,1), ($1,'31-60 days',31,60,2), ($1,'61-90 days',61,90,3),
        ($1,'91-120 days',91,120,4), ($1,'120+ days',121,NULL,5)
       ON CONFLICT DO NOTHING`,
      [cid]
    );
    await client.query(
      `INSERT INTO company_settings (company_id, usd_to_myr_rate) VALUES ($1, 4)
       ON CONFLICT (company_id) DO NOTHING`,
      [cid]
    );
    await client.query('COMMIT');
    await recordPlatformAudit(req, {
      action: 'COMPANY_CREATE', entityType: 'company', entityId: cid, companyId: cid,
      details: { name: String(name).trim(), reg_no: reg_no || null, group_id: group_id || null },
    });
    res.status(201).json({ company: { id: cid } });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const COMPANY_FIELDS = ['name', 'reg_no', 'country_code', 'notes', 'group_id'];
async function updateCompany(req, res) {
  const fields = {};
  for (const f of COMPANY_FIELDS) if (f in req.body) fields[f] = req.body[f] === '' ? null : req.body[f];
  const cols = Object.keys(fields);
  if (cols.length === 0) return res.json({ company: { id: req.params.id } });

  const before = await pool.query(`SELECT name, group_id FROM companies WHERE id = $1`, [req.params.id]);
  if (!before.rows[0]) return res.status(404).json({ error: 'Company not found.' });

  const setClause = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const result = await pool.query(
    `UPDATE companies SET ${setClause} WHERE id = $1 RETURNING id`,
    [req.params.id, ...cols.map((c) => fields[c])]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Company not found.' });
  await recordPlatformAudit(req, {
    action: 'COMPANY_UPDATE', entityType: 'company', entityId: req.params.id, companyId: req.params.id,
    details: { changed: fields, previous_group_id: before.rows[0].group_id },
  });
  res.json({ company: { id: req.params.id } });
}

// Suspend / reactivate, deliberately its own endpoint rather than a field
// on updateCompany — it's the one action here with immediate, visible
// consequences for real users, so it takes a reason and is logged as its
// own event rather than being buried in a generic field diff.
//
// Effect: every user of a suspended company is refused at login AND has
// their live session ended on the next request (see auth.controller.js's
// login + me). Data is untouched and fully restored on reactivation —
// this is a suspension, never a deletion.
async function setCompanySuspension(req, res) {
  const { is_active, reason } = req.body;
  if (typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'is_active (true/false) is required.' });
  }
  if (!is_active && !String(reason || '').trim()) {
    return res.status(400).json({ error: 'A reason is required when suspending a company.' });
  }

  const result = await pool.query(
    `UPDATE companies
        SET is_active = $2,
            suspended_at = CASE WHEN $2 THEN NULL ELSE now() END,
            suspended_reason = CASE WHEN $2 THEN NULL ELSE $3 END
      WHERE id = $1
      RETURNING id, name`,
    [req.params.id, is_active, String(reason || '').trim() || null]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Company not found.' });

  await recordPlatformAudit(req, {
    action: is_active ? 'COMPANY_REACTIVATE' : 'COMPANY_SUSPEND',
    entityType: 'company', entityId: req.params.id, companyId: req.params.id,
    details: { name: result.rows[0].name, reason: reason || null },
  });
  res.json({ company: { id: req.params.id, is_active } });
}

// Only ever a hard delete for a company that was never actually used —
// zero users, events, or exhibitors. Anything beyond that must be
// suspended instead (setCompanySuspension), never deleted: audit_log
// correctly FK-references companies, and a populated tenant's own history
// must survive. This exists purely to clean up a company registered by
// mistake before anyone touched it.
async function deleteCompany(req, res) {
  const company = await pool.query(
    `SELECT c.name,
            (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS user_count,
            (SELECT COUNT(*) FROM events e WHERE e.company_id = c.id) AS event_count,
            (SELECT COUNT(*) FROM exhibitors e WHERE e.company_id = c.id) AS exhibitor_count
     FROM companies c WHERE c.id = $1`,
    [req.params.id]
  );
  if (!company.rows[0]) return res.status(404).json({ error: 'Company not found.' });
  const { user_count, event_count, exhibitor_count, name } = company.rows[0];
  if (Number(user_count) > 0 || Number(event_count) > 0 || Number(exhibitor_count) > 0) {
    return res.status(409).json({
      error: 'This company has real data (users, events, or exhibitors) — suspend it instead of deleting. Deleting is only for a company registered by mistake that was never actually used.',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const t of ['roles', 'sales_stages', 'aging_buckets', 'company_settings', 'approval_rules']) {
      await client.query(`DELETE FROM ${t} WHERE company_id = $1`, [req.params.id]);
    }
    await client.query(`DELETE FROM companies WHERE id = $1`, [req.params.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await recordPlatformAudit(req, { action: 'COMPANY_DELETE', entityType: 'company', entityId: req.params.id, details: { name } });
  res.json({ success: true });
}

// The company's own users, so the platform operator can see who to contact
// and, if needed, fix a login — this is the recovery path for a tenant
// whose only Admin is locked out, since there is no self-service "forgot
// password" inside the tenant app itself (custom-built auth, per CLAUDE.md
// rule #4 — no vendor to hand that off to).
async function listCompanyUsers(req, res) {
  const result = await pool.query(
    `SELECT u.id, u.email, u.full_name, u.is_active, r.code AS role_code, r.name AS role_name
     FROM users u LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.company_id = $1 ORDER BY u.full_name`,
    [req.params.id]
  );
  res.json({ users: result.rows });
}

// Deliberately narrow: email and full_name only, not role or is_active —
// those are the tenant's own Admin's call from inside Admin > Users. This
// is for fixing a wrong login email or a name typo entered at registration,
// not for platform-console user administration.
async function updateCompanyUser(req, res) {
  const { email, full_name } = req.body;
  const fields = {};
  if (email !== undefined) fields.email = String(email).trim().toLowerCase();
  if (full_name !== undefined) fields.full_name = String(full_name).trim();
  const cols = Object.keys(fields);
  if (cols.length === 0) return res.json({ user: { id: req.params.userId } });

  const setClause = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
  const result = await pool.query(
    `UPDATE users SET ${setClause} WHERE id = $1 AND company_id = $2 RETURNING id`,
    [req.params.userId, req.params.id, ...cols.map((c) => fields[c])]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'User not found.' });
  await recordPlatformAudit(req, {
    action: 'TENANT_USER_UPDATE', entityType: 'user', entityId: req.params.userId, companyId: req.params.id,
    details: { changed: fields },
  });
  res.json({ user: { id: req.params.userId } });
}

// The actual "forgot password" recovery mechanism for tenants: rather than
// a self-service email-reset flow (more infrastructure, more attack
// surface, and this product has no per-tenant outbound-email identity to
// send it from convincingly), a locked-out company contacts the platform
// operator, who resets it here — same one-time-password-in-the-response
// pattern as createCompanyAdmin.
async function resetCompanyUserPassword(req, res) {
  const user = await pool.query(`SELECT email FROM users WHERE id = $1 AND company_id = $2`, [req.params.userId, req.params.id]);
  if (!user.rows[0]) return res.status(404).json({ error: 'User not found.' });

  const tempPassword = require('crypto').randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12) + '!1';
  const passwordHash = await hashPassword(tempPassword);
  await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, req.params.userId]);

  await recordPlatformAudit(req, {
    action: 'TENANT_USER_PASSWORD_RESET', entityType: 'user', entityId: req.params.userId, companyId: req.params.id,
    details: { email: user.rows[0].email },
  });
  res.json({ user: { id: req.params.userId, email: user.rows[0].email, temp_password: tempPassword } });
}

async function listPlatformAudit(req, res) {
  const result = await pool.query(
    `SELECT l.id, l.admin_email, l.action, l.entity_type, l.entity_id, l.details, l.created_at,
            c.name AS company_name
     FROM platform_audit_log l
     LEFT JOIN companies c ON c.id = l.company_id
     ORDER BY l.created_at DESC
     LIMIT 200`
  );
  res.json({ entries: result.rows });
}

// The tenant's first Admin. Deliberately the ONLY user-creating action in
// this console: the platform operator bootstraps one Admin per company,
// and that Admin adds everyone else from inside their own tenant. Refuses
// if the company already has users, so this can't be used as a back door
// into an established tenant.
async function createCompanyAdmin(req, res) {
  const { email, full_name } = req.body;
  if (!email || !full_name) return res.status(400).json({ error: 'email and full_name are required.' });

  const company = await pool.query(`SELECT id, name FROM companies WHERE id = $1`, [req.params.id]);
  if (!company.rows[0]) return res.status(404).json({ error: 'Company not found.' });

  const existing = await pool.query(`SELECT COUNT(*) FROM users WHERE company_id = $1`, [req.params.id]);
  if (Number(existing.rows[0].count) > 0) {
    return res.status(409).json({
      error: 'This company already has users — its own Admin should add further accounts from inside the company.',
    });
  }

  const role = await pool.query(`SELECT id FROM roles WHERE company_id = $1 AND code = 'ADM'`, [req.params.id]);
  if (!role.rows[0]) return res.status(400).json({ error: 'This company has no ADM role set up.' });

  const tempPassword = require('crypto').randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12) + '!1';
  const passwordHash = await hashPassword(tempPassword);
  const user = await pool.query(
    `INSERT INTO users (company_id, role_id, email, password_hash, full_name)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [req.params.id, role.rows[0].id, String(email).trim().toLowerCase(), passwordHash, String(full_name).trim().toUpperCase()]
  );
  // requireAdmin checks user_roles, not just users.role_id — without this
  // the account would look like an Admin but be refused by every
  // admin-gated route (a real bug hit when the Railway admin was seeded).
  await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [user.rows[0].id, role.rows[0].id]);

  await recordPlatformAudit(req, {
    action: 'TENANT_ADMIN_CREATE', entityType: 'user', entityId: user.rows[0].id, companyId: req.params.id,
    details: { email: String(email).trim().toLowerCase(), company: company.rows[0].name },
  });

  res.status(201).json({ user: { id: user.rows[0].id, email, temp_password: tempPassword } });
}

module.exports = {
  platformLogin, platformMe, platformLogout, platformChangePassword,
  listGroups, createGroup, updateGroup, deleteGroup,
  listCompanies, createCompany, updateCompany, deleteCompany, setCompanySuspension, createCompanyAdmin,
  listCompanyUsers, updateCompanyUser, resetCompanyUserPassword,
  listPlatformAudit,
};
