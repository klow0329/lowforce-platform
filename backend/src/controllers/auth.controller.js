const { pool } = require('../config/db');
const { verifyPassword, hashPassword } = require('../utils/password');

async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const result = await pool.query(
    `SELECT u.id, u.company_id, u.email, u.password_hash, u.full_name, u.is_active,
            r.code AS role_code
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE LOWER(u.email) = LOWER($1)`,
    [email]
  );

  const user = result.rows[0];

  // Deliberately vague error message on both "no such user" and
  // "wrong password" — doesn't tell an attacker which one was wrong.
  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const passwordMatches = await verifyPassword(password, user.password_hash);
  if (!passwordMatches) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  // Store only what's needed in the session — never the password hash.
  req.session.user = {
    id: user.id,
    company_id: user.company_id,
    email: user.email,
    full_name: user.full_name,
    role_code: user.role_code,
  };

  res.json({ user: req.session.user });
}

function logout(req, res) {
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
    `SELECT u.id, u.company_id, u.email, u.full_name, u.is_active,
            r.code AS role_code
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [req.session.user.id]
  );

  const user = result.rows[0];
  if (!user || !user.is_active) {
    return req.session.destroy(() => res.json({ user: null }));
  }

  req.session.user = {
    id: user.id,
    company_id: user.company_id,
    email: user.email,
    full_name: user.full_name,
    role_code: user.role_code,
  };

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

module.exports = { login, logout, me, changePassword };
