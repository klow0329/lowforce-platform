// Creates (or resets) a platform-owner account — the LowForce operator's
// own login, outside every tenant. Run it yourself:
//
//   node backend/scripts/create-platform-admin.js you@example.com "Your Name"
//
// A strong random password is generated and printed ONCE. It is never
// stored in plain text, never committed, and never passed as an argument
// (which would leave it in your shell history).
require('dotenv').config();
const crypto = require('crypto');
const { pool } = require('../src/config/db');
const { hashPassword } = require('../src/utils/password');

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
  console.log('  Save this now — it is not recoverable. Sign in at /platform');
  console.log('');
  await pool.end();
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
