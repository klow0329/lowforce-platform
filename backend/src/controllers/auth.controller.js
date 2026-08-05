const crypto = require('crypto');
const { pool } = require('../config/db');
const { verifyPassword, hashPassword } = require('../utils/password');
const { passwordPolicyError } = require('../utils/passwordPolicy');
const { recordAudit } = require('../utils/auditLog');
const { sendMail } = require('../utils/mailer');
const { fillTemplate, DEFAULT_FORGOT_PASSWORD_SUBJECT, DEFAULT_FORGOT_PASSWORD_BODY } = require('../utils/emailTemplate');

// Self-service "Forgot Password" (2026-08-05) — the real recovery path for
// a user who can't reach an Admin (or is the only Admin) and is stuck
// waiting on SSO. Token lifetime is short (60 min, not the tax-detail
// link's 5 days) since a password reset link is a higher-value target if
// intercepted.
const RESET_TOKEN_LIFETIME_MINUTES = 60;

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

// PUBLIC — no login (that's the point). Same email + optional company_id
// disambiguation as login itself, and the same multi-company picker shape
// (requiresCompanySelection), so a user with accounts at more than one
// company sees a consistent flow either way.
//
// Always responds with the same generic success message regardless of
// whether the email matched anything — an attacker probing emails learns
// nothing from the response. The one exception, matching login's own
// existing tradeoff: if the email has MORE than one active company, the
// requiresCompanySelection response does reveal that much (which login
// already does today) — not a new leak this feature introduces.
async function forgotPassword(req, res) {
  const { email, company_id } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  const result = await pool.query(
    `SELECT u.id, u.email, u.full_name, u.is_active, u.company_id, c.name AS company_name, c.is_active AS company_is_active
     FROM users u
     JOIN companies c ON c.id = u.company_id
     WHERE LOWER(u.email) = LOWER($1)
       AND ($2::uuid IS NULL OR u.company_id = $2)`,
    [email, company_id || null]
  );
  const active = result.rows.filter((u) => u.is_active && u.company_is_active);

  if (!company_id && active.length > 1) {
    return res.json({
      requiresCompanySelection: true,
      companies: active.map((u) => ({ id: u.company_id, name: u.company_name })),
    });
  }

  const user = active[0];
  const genericResponse = { success: true, message: 'If that email has an account, a password reset link has been sent to it.' };

  if (!user) return res.json(genericResponse);

  // Throttle: a live, unused token issued in the last 2 minutes means
  // don't issue (or email) another one — stops accidental double-clicks or
  // deliberate spam from flooding the inbox, without needing a full
  // rate-limiter for what's otherwise a low-traffic endpoint.
  const recent = await pool.query(
    `SELECT 1 FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL AND created_at > now() - interval '2 minutes'`,
    [user.id]
  );
  if (recent.rows[0]) return res.json(genericResponse);

  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, now() + interval '${RESET_TOKEN_LIFETIME_MINUTES} minutes')`,
    [user.id, token]
  );

  const resetUrl = `${req.protocol}://${req.get('host')}/reset-password/${token}`;
  const tpl = await pool.query(
    `SELECT subject, body FROM email_templates WHERE company_id = $1 AND template_key = 'FORGOT_PASSWORD'`,
    [user.company_id]
  );
  const vars = { full_name: user.full_name, email: user.email, company_name: user.company_name, reset_url: resetUrl, expires_minutes: RESET_TOKEN_LIFETIME_MINUTES };
  const subject = fillTemplate(tpl.rows[0]?.subject || DEFAULT_FORGOT_PASSWORD_SUBJECT, vars);
  const body = fillTemplate(tpl.rows[0]?.body || DEFAULT_FORGOT_PASSWORD_BODY, vars);
  await sendMail({ to: user.email, subject, text: body });

  recordAudit({
    companyId: user.company_id, userId: user.id, userName: user.full_name, roleCode: null,
    action: 'FORGOT_PASSWORD_REQUESTED', entityType: 'auth', entityId: user.id, details: { email },
  });

  res.json(genericResponse);
}

// PUBLIC — lets the reset-password PAGE check a token is real/live before
// showing the form, without yet consuming it (only the actual submit does).
async function getResetTokenInfo(req, res) {
  const result = await pool.query(
    `SELECT prt.expires_at, prt.used_at, u.email
     FROM password_reset_tokens prt JOIN users u ON u.id = prt.user_id
     WHERE prt.token = $1`,
    [req.params.token]
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'This link is invalid.' });
  if (row.used_at) return res.status(410).json({ error: 'This link has already been used.' });
  if (new Date(row.expires_at) < new Date()) return res.status(410).json({ error: 'This link has expired — request a new one.' });
  res.json({ email: row.email });
}

// PUBLIC — the actual reset. FOR UPDATE row lock, same pattern as
// tax_detail_links' submitLink, so two near-simultaneous submits of the
// same token can't both succeed.
async function resetPasswordWithToken(req, res) {
  const { new_password } = req.body;
  const policyError = passwordPolicyError(new_password);
  if (policyError) return res.status(400).json({ error: policyError });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token = $1 FOR UPDATE`,
      [req.params.token]
    );
    const row = result.rows[0];
    if (!row) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'This link is invalid.' }); }
    if (row.used_at) { await client.query('ROLLBACK'); return res.status(410).json({ error: 'This link has already been used.' }); }
    if (new Date(row.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'This link has expired — request a new one.' });
    }

    // Re-check the account/company are still active — a token issued
    // before a suspension (or deactivation) must not be usable to bypass
    // it, even if the token itself hasn't technically expired yet.
    const user = await client.query(
      `SELECT u.company_id, u.full_name, u.is_active, c.is_active AS company_is_active FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = $1`,
      [row.user_id]
    );
    if (!user.rows[0] || !user.rows[0].is_active || !user.rows[0].company_is_active) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'This account is no longer active.' });
    }

    const passwordHash = await hashPassword(new_password);
    await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, row.user_id]);
    await client.query(`UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`, [row.id]);
    await client.query('COMMIT');

    recordAudit({
      companyId: user.rows[0].company_id, userId: row.user_id, userName: user.rows[0].full_name, roleCode: null,
      action: 'PASSWORD_RESET_VIA_TOKEN', entityType: 'auth', entityId: row.user_id, details: {},
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.json({ success: true });
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
  const policyError = passwordPolicyError(new_password);
  if (policyError) return res.status(400).json({ error: policyError });

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

module.exports = { login, logout, me, switchRole, changePassword, forgotPassword, getResetTokenInfo, resetPasswordWithToken };
