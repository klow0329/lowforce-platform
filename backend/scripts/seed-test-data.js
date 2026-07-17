// Seeds the shared TESTING environment with named test users and temporary
// demo data. Safe to re-run — every insert checks for an existing row first.
// All of this data is disposable and expected to change before real use.
// Usage: node scripts/seed-test-data.js
require('dotenv').config();
const { pool } = require('../src/config/db');
const { hashPassword } = require('../src/utils/password');

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const TEMP_PASSWORD = 'lowforce123'; // temporary — hand out, then have each user change it

const TEST_USERS = [
  { email: 'admin@lowforce.test',   fullName: 'Test Admin',    roleCode: 'ADM' },
  { email: 'aisyah@lowforce.test',  fullName: 'Aisyah Rahman', roleCode: 'SALES' },
  { email: 'marcus@lowforce.test',  fullName: 'Marcus Tan',    roleCode: 'SALES' },
  { email: 'priya@lowforce.test',   fullName: 'Priya Nair',    roleCode: 'SALES' },
  { email: 'finance@lowforce.test', fullName: 'Test Finance',  roleCode: 'FIN' },
];

const TEST_EXHIBITORS = [
  { name: 'Borneo Coffee Roasters',       country: 'MY', contact: 'Lim Mei Fen',   email: 'meifen@borneocoffee.example' },
  { name: 'Mekong Delta Seafood Co',      country: 'VN', contact: 'Nguyen Van An', email: 'an@mekongseafood.example' },
  { name: 'Chennai Spice Traders',        country: 'IN', contact: 'Ravi Kumar',    email: 'ravi@chennaispice.example' },
  { name: 'Singapore FoodTech Solutions', country: 'SG', contact: 'Wong Jia Hui',  email: 'jiahui@sgfoodtech.example' },
  { name: 'Bangkok Packaging Industries', country: 'TH', contact: 'Somchai P.',    email: 'somchai@bkkpack.example' },
  { name: 'Java Organic Farms',           country: 'ID', contact: 'Dewi Lestari',  email: 'dewi@javaorganic.example' },
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // --- Test users ---------------------------------------------------------
    const passwordHash = await hashPassword(TEMP_PASSWORD);
    for (const u of TEST_USERS) {
      const role = await client.query(
        `SELECT id FROM roles WHERE company_id = $1 AND code = $2`,
        [COMPANY_ID, u.roleCode]
      );
      await client.query(
        `INSERT INTO users (company_id, role_id, email, password_hash, full_name)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (company_id, email) DO NOTHING`,
        [COMPANY_ID, role.rows[0].id, u.email, passwordHash, u.fullName]
      );
    }

    // --- Second event, to exercise the multi-event selector ----------------
    await client.query(
      `INSERT INTO events (company_id, code, name, event_year, is_active)
       VALUES ($1, 'MYFT26', 'MYFT 2026', 2026, TRUE)
       ON CONFLICT (company_id, code) DO NOTHING`,
      [COMPANY_ID]
    );

    // --- Exhibitors ---------------------------------------------------------
    for (const ex of TEST_EXHIBITORS) {
      await client.query(
        `INSERT INTO exhibitors (company_id, company_name, country_code, contact1_name, contact1_email)
         SELECT $1, $2, $3, $4, $5
         WHERE NOT EXISTS (SELECT 1 FROM exhibitors WHERE company_id = $1 AND company_name = $2)`,
        [COMPANY_ID, ex.name, ex.country, ex.contact, ex.email]
      );
    }

    // --- Opportunities spread across both events and the sales users -------
    // (skipped wholesale if any test-exhibitor opportunity already exists)
    const existing = await client.query(
      `SELECT 1 FROM opportunities o
       JOIN exhibitors ex ON ex.id = o.exhibitor_id
       WHERE o.company_id = $1 AND ex.company_name = ANY($2) LIMIT 1`,
      [COMPANY_ID, TEST_EXHIBITORS.map((e) => e.name)]
    );

    if (existing.rows.length === 0) {
      const events = await client.query(
        `SELECT id, code FROM events WHERE company_id = $1`, [COMPANY_ID]
      );
      const stages = await client.query(
        `SELECT id, code FROM sales_stages WHERE company_id = $1`, [COMPANY_ID]
      );
      const users = await client.query(
        `SELECT id, email FROM users WHERE company_id = $1`, [COMPANY_ID]
      );
      const exhibitors = await client.query(
        `SELECT id, company_name FROM exhibitors WHERE company_id = $1`, [COMPANY_ID]
      );

      const eventBy = (code) => events.rows.find((e) => e.code === code).id;
      const stageBy = (code) => stages.rows.find((s) => s.code === code).id;
      const userBy = (email) => users.rows.find((u) => u.email === email)?.id || null;
      const exBy = (name) => exhibitors.rows.find((e) => e.company_name === name).id;

      const opportunities = [
        // MIFB26 — assigned across the new sales users
        { ex: 'Borneo Coffee Roasters',       event: 'MIFB26', stage: 'STG40', sales: 'aisyah@lowforce.test',  sqm: 18, type: 'Standard',  value: 25200, followUp: 5 },
        { ex: 'Mekong Delta Seafood Co',      event: 'MIFB26', stage: 'STG10', sales: 'aisyah@lowforce.test',  sqm: 9,  type: 'Standard',  value: 12600, followUp: -2 }, // overdue → shows in Follow-Ups Due
        { ex: 'Chennai Spice Traders',        event: 'MIFB26', stage: 'STG80', sales: 'marcus@lowforce.test',  sqm: 36, type: 'Raw Space', value: 43200, followUp: 10 },
        { ex: 'Singapore FoodTech Solutions', event: 'MIFB26', stage: 'WON',   sales: 'marcus@lowforce.test',  sqm: 27, type: 'Raw Space', value: 32400, followUp: null },
        { ex: 'Bangkok Packaging Industries', event: 'MIFB26', stage: 'LOSE',  sales: 'priya@lowforce.test',   sqm: 12, type: 'Standard',  value: 16800, followUp: null },
        // MYFT26 — so the event switcher shows different data per event
        { ex: 'Java Organic Farms',           event: 'MYFT26', stage: 'STG40', sales: 'priya@lowforce.test',   sqm: 15, type: 'Standard',  value: 21000, followUp: 7 },
        { ex: 'Borneo Coffee Roasters',       event: 'MYFT26', stage: 'STG10', sales: 'aisyah@lowforce.test',  sqm: 9,  type: 'Standard',  value: 12600, followUp: 14 },
      ];

      for (const o of opportunities) {
        await client.query(
          `INSERT INTO opportunities (company_id, event_id, exhibitor_id, salesperson_id, stage_id, booth_sqm, booth_type, estimated_value_myr, next_follow_up_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9::int IS NULL THEN NULL ELSE CURRENT_DATE + $9::int END)`,
          [COMPANY_ID, eventBy(o.event), exBy(o.ex), userBy(o.sales), stageBy(o.stage), o.sqm, o.type, o.value, o.followUp]
        );
      }
    }

    await client.query('COMMIT');
    console.log('Test data seeded.');
    console.log(`\nTest accounts (temporary password for all: ${TEMP_PASSWORD}):`);
    for (const u of TEST_USERS) console.log(`  ${u.email.padEnd(26)} ${u.fullName} (${u.roleCode})`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
