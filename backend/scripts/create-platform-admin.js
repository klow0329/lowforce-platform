// Creates (or resets) a platform-owner account — the LowForce operator's
// own login, outside every tenant.
//
// Local database:
//   node backend/scripts/create-platform-admin.js you@example.com "Your Name"
//
// Railway (production) — use the Postgres SERVICE, not lowforce-platform:
// only Postgres carries DATABASE_PUBLIC_URL (the app service only has the
// internal-only DATABASE_URL, unreachable from a laptop). `railway run`
// injects it as an env var, so no credential is ever typed or left in
// shell history:
//   railway run --service Postgres node backend/scripts/create-platform-admin.js you@example.com "Your Name"
//
// Also doubles as a password RESET for an existing email (ON CONFLICT
// below upserts) — this is the recovery path if you forget your own
// platform password.
//
// A strong random password is generated and printed ONCE. It is never
// stored in plain text, never committed, and never passed as an argument.
require('dotenv').config();
const crypto = require('crypto');
const { Pool } = require('pg');
const { hashPassword } = require('../src/utils/password');

// Under `railway run` the injected DATABASE_URL points at the *internal*
// host (postgres.railway.internal), which only resolves inside Railway's
// network — it can't be reached from a laptop. DATABASE_PUBLIC_URL is the
// TCP-proxy address that can, so prefer it whenever Railway provides it.
// Falls back to the ordinary local DATABASE_URL for dev.
const connectionString = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const isRemote = /proxy\.rlwy\.net|railway/.test(connectionString || '');
const pool = new Pool({
  connectionString,
  ...(isRemote ? { ssl: { rejectUnauthorized: false } } : {}),
});

async function main() {
  const [email, fullName] = process.argv.slice(2);
  if (!email || !fullName) {
    console.error('Usage: node backend/scripts/create-platform-admin.js <email> "<Full Name>"');
    process.exit(1);
  }

  // 18 random bytes -> ~24 URL-safe chars. Long enough that this account
  // being internet-facing isn't a brute-force concern.
  const password = crypto.randomBytes(18).toString('base64url');
  const passwordHash = await hashPassword(password);

  const result = await pool.query(
    `INSERT INTO platform_admins (email, password_hash, full_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name, is_active = TRUE
     RETURNING id, (xmax = 0) AS created`,
    [email.trim().toLowerCase(), passwordHash, fullName.trim()]
  );

  console.log('');
  console.log(result.rows[0].created ? '  Platform admin created.' : '  Platform admin already existed — password reset.');
  console.log('');
  console.log('  Email:    ' + email.trim().toLowerCase());
  console.log('  Password: ' + password);
  console.log('');
  // Which database this actually hit matters a lot — creating the account
  // on the wrong one is the likeliest way to be locked out in production.
  console.log('  Database: ' + (isRemote ? 'REMOTE (Railway)' : 'local'));
  console.log('');
  console.log('  Save this now — it is not recoverable. Sign in at /platform');
  console.log('');
  await pool.end();
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
