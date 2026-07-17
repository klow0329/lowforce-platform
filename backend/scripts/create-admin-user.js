// One-off script to create the first admin user with a properly hashed
// password. Usage: node scripts/create-admin-user.js <email> <password> <full_name>
require('dotenv').config();
const { pool } = require('../src/config/db');
const { hashPassword } = require('../src/utils/password');

const ONE_INTERNATIONAL_COMPANY_ID = '00000000-0000-0000-0000-000000000001';

async function main() {
  const [email, password, fullName] = process.argv.slice(2);
  if (!email || !password || !fullName) {
    console.error('Usage: node scripts/create-admin-user.js <email> <password> "<full name>"');
    process.exit(1);
  }

  const role = await pool.query(
    `SELECT id FROM roles WHERE company_id = $1 AND code = 'ADM'`,
    [ONE_INTERNATIONAL_COMPANY_ID]
  );

  const passwordHash = await hashPassword(password);

  const result = await pool.query(
    `INSERT INTO users (company_id, role_id, email, password_hash, full_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (company_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id, email`,
    [ONE_INTERNATIONAL_COMPANY_ID, role.rows[0].id, email, passwordHash, fullName]
  );

  console.log('User ready:', result.rows[0]);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
