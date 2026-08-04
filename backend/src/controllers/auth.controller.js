const { pool } = require('../config/db');
const { verifyPassword, hashPassword } = require('../utils/password');
const { recordAudit } = require('../utils/auditLog');

async function getAvailableRoles(userId) {
  const result = await pool.query(
    `SELECT r.code, r.name FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1
     ORDER BY r.sort_order`,
    [userId]
  );
  return result.rows;
}

async function login(req, res) {
  const { email, password, company_id } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  // A person who consults for or works at several client companies (e.g. an
  // agent or a shared services user) can have a separate account under the
  // same email in each — the schema already allows this (UNIQUE is
  // company_id+email, not email alone). company_id narrows to one specific
  // account once the user has picked which company to log into; omitted on
  // the first attempt, when it isn't known yet.
  const result = await pool.query(
    `SELECT u.id, u.company_id, u.email, u.password_hash, u.full_name, u.is_active, u.access_level_override,
            r.code AS role_code, c.name AS company_name, c.is_active AS company_is_active
     FROM users u
     JOIN companies c ON c.id = u.company_id
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE LOWER(u.email) = LOWER($1)
       AND ($2::uuid IS NULL OR u.company_id = $2)`,
    [email, company_id || null]
  );

  // A suspended COMPANY blocks every one of its users, regardless of their
  // own is_active. Until this was added, `companies.is_active` was written
  // but never read anywhere, so suspending a tenant from the platform
  // console would have had no effect at all — people would simply have
  // carried on working.
  const active = result.rows.filter((u) => u.is_active && u.company_is_active);

  // More than one company has an active account under this email, and the
  // caller hasn't said which one yet — can't verify a password without
  // knowing that, since each company's account is independently
  // administered and may have a different password. Ask which company
  // before touching credentials at all (same pattern as Slack's "this email
  // is in multiple workspaces" picker); the frontend resubmits with
  // company_id once the person picks one.
  if (!company_id && active.length > 1) {
    return res.json({
      requiresCompanySelection: true,
      companies: active.map((u) => ({ id: u.company_id, name: u.company_name })),
    });
  }

  // Otherwise this is a normal single-account login: either company_id
  // narrowed the query to exactly one candidate row, or this email only
  // ever had one account to begin with. Falls back to an inactive match
  // (if that's all there is) purely so the failed-login audit entry below
  // can still record the real reason, matching the original behaviour.
  const user = active[0] || result.rows[0];

  // Deliberately vague error message on both "no such user" and "wrong
  // password" — doesn't tell an attacker which one was wrong. Only logged
  // to the audit trail when the email matched a real account (whether
  // inactive or wrong password) — an unknown email has no company to
  // attribute the attempt to, and per multi-tenant isolation no one could
  // ever view it anyway.
  // company_is_active must be checked HERE too, not only in the `active`
  // filter above: that filter feeds the multi-company picker, but this line
  // falls back to `result.rows[0]` when nothing is active, so a user whose
  // own is_active is true would otherwise sail straight through even though
  // their company is suspended. Caught by live test — suspension killed
  // existing sessions but a fresh login still succeeded.
  if (!user || !user.is_active || !user.company_is_active) {
    if (user) {
      recordAudit({
        companyId: user.company_id, userId: user.id, userName: user.full_name, roleCode: user.role_code,
        action: 'FAILED_LOGIN', entityType: 'auth', entityId: user.id,
        details: { email, reason: user.is_active ? 'company_suspended' : 'inactive_account' },
      });
    }
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const passwordMatches = await verifyPassword(password, user.password_hash);
  if (!passwordMatches) {
    recordAudit({
      companyId: user.company_id, userId: user.id, userName: user.full_name, roleCode: user.role_code,
      action: 'FAILED_LOGIN', entityType: 'auth', entityId: user.id, details: { email, reason: 'wrong_password' },
    });
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  // Store only what's needed in the session — never the password hash.
  // role_code here is the user's ACTIVE role for this session, seeded from
  // their default/primary role — see switchRole for how it changes.
  req.session.user = {
    id: user.id,
    company_id: user.company_id,
    email: user.email,
    full_name: user.full_name,
    role_code: user.role_code,
    access_level_override: user.access_level_override,
  };

  recordAudit({
    companyId: user.company_id, userId: user.id, userName: user.full_name, roleCode: user.role_code,
    action: 'LOGIN', entityType: 'auth', entityId: user.id, details: { email, company: user.company_name },
  });

  const availableRoles = await getAvailableRoles(user.id);
  res.json({ user: req.session.user, availableRoles });
}

function logout(req, res) {
  const user = req.session && req.session.user;
  if (user) {
    recordAudit({
      companyId: user.company_id, userId: user.id, userName: user.full_name, roleCode: user.role_code,
      action: 'LOGOUT', entityType: 'auth', entityId: user.id,
    });
  }
  req.session.destroy(() => {
    res.json({ success: true });
  });
}

// Re-checks the database on every call rather than trusting the stored
// session — sessions persist across restarts now, so a user who was
// deactivated or demoted since logging in must lose access immediately.
async function me(req, res) {
  if (!req.session || !req.session.user) {
    return res.json({ user: null });
  }

  const result = await pool.query(
    `SELECT u.id, u.company_id, u.email, u.full_name, u.is_active, u.access_level_override,
            r.code AS role_code, c.is_active AS company_is_active
     FROM users u
     JOIN companies c ON c.id = u.company_id
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [req.session.user.id]
  );

  const user = result.rows[0];
  // company_is_active is re-checked here too, not just at login, so
  // suspending a tenant ends its users' LIVE sessions rather than waiting
  // for them to log out — the whole point of a suspension.
  if (!user || !user.is_active || !user.company_is_active) {
    return req.session.destroy(() => res.json({ user: null }));
  }

  const availableRoles = await getAvailableRoles(user.id);

  // Preserve whichever role the user last switched to, as long as it's
  // still one of their assigned roles — otherwise every page load (this
  // runs on each one) would silently snap them back to their primary role
  // mid-session. Falls back to primary if that role was revoked.
  const stillAssigned = availableRoles.some((r) => r.code === req.session.user.role_code);
  const activeRoleCode = stillAssigned ? req.session.user.role_code : user.role_code;

  req.session.user = {
    id: user.id,
    company_id: user.company_id,
    email: user.email,
    full_name: user.full_name,
    role_code: activeRoleCode,
    access_level_override: user.access_level_override,
  };

  res.json({ user: req.session.user, availableRoles });
}

// Switches which of the user's assigned roles is "active" for this
// session — every subsequent request's req.roleCode (see middleware/
// tenant.js) reflects it immediately.
async function switchRole(req, res) {
  const { role_code } = req.body;
  if (!role_code) {
    return res.status(400).json({ error: 'role_code is required.' });
  }

  const availableRoles = await getAvailableRoles(req.session.user.id);
  if (!availableRoles.some((r) => r.code === role_code)) {
    return res.status(403).json({ error: 'That role is not assigned to your account.' });
  }

  req.session.user.role_code = role_code;
  res.json({ user: req.session.user });
}

async function changePassword(req, res) {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current and new password are required.' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }

  const result = await pool.query(
    `SELECT password_hash FROM users WHERE id = $1`,
    [req.session.user.id]
  );

  const matches = await verifyPassword(current_password, result.rows[0].password_hash);
  if (!matches) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const newHash = await hashPassword(new_password);
  await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, req.session.user.id]);

  res.json({ success: true });
}

module.exports = { login, logout, me, switchRole, changePassword };
