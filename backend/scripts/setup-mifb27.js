// Sets up the fresh MIFB27 cycle:
//   1. Creates the MIFB27 event (if missing) and grants all existing
//      non-admin users access to it.
//   2. Seeds the price list for MIFB26 (real rates from the Excel LIST
//      sheet, for reference/testing) and copies them to MIFB27 as the
//      starting point — adjust MIFB27 prices in the Price List screen.
// Safe to re-run: skips any event that already has price list rows.
// Usage: node scripts/setup-mifb27.js
require('dotenv').config();
const { pool } = require('../src/config/db');

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';

// Real MIFB26 rates from the Excel LIST sheet (per-sqm unless noted).
const RATE_TIERS = ['PUBLISHED RATE', 'EARLY BIRD', 'ONSITE REBOOKING', 'CONTRA'];
const TIER_PRICES = {
  //                     BAS            SSS         ESS         WOP         COC (corner, per unit)
  'PUBLISHED RATE':   { BAS: [1350, 420], SSS: [300, 40], ESS: [450, 80], WOP: [395, 60], COC: [800, 180] },
  'EARLY BIRD':       { BAS: [1200, 366], SSS: [300, 40], ESS: [450, 80], WOP: [395, 60], COC: [800, 180] },
  'ONSITE REBOOKING': { BAS: [1080, 345], SSS: [300, 40], ESS: [450, 80], WOP: [395, 60], COC: [800, 180] },
  'CONTRA':           { BAS: [1350, 420], SSS: [300, 40], ESS: [450, 80], WOP: [395, 60], COC: [800, 180] },
};
const ITEM_NAMES = {
  BAS: 'Bare Space (per sqm)',
  SSS: 'Shell Scheme (per sqm)',
  ESS: 'Enhanced Shell (per sqm)',
  WOP: 'Walk On Package (per sqm)',
  COC: 'Corner Charge',
};
// Items without a fixed tier price — priced per deal or by formula.
// (Descriptions are editable per event on the Price List screen.)
const VARIABLE_ITEMS = [
  { code: 'LOD', description: 'Loading — 15% of Bare Space' },
  { code: 'CUB', description: 'Customized Booth — per agreement' },
  { code: 'SPO', description: 'Sponsorship — per agreement' },
  { code: 'OTH', description: 'Others — per agreement' },
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. MIFB27 event + access grants
    await client.query(
      `INSERT INTO events (company_id, code, name, event_year, is_active)
       VALUES ($1, 'MIFB27', 'MIFB 2027', 2027, TRUE)
       ON CONFLICT (company_id, code) DO NOTHING`,
      [COMPANY_ID]
    );
    await client.query(
      `INSERT INTO user_event_access (user_id, event_id)
       SELECT u.id, e.id
       FROM users u
       CROSS JOIN events e
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.company_id = $1 AND e.company_id = $1 AND e.code = 'MIFB27'
         AND (r.code IS NULL OR r.code NOT IN ('ADM','MGT'))
       ON CONFLICT DO NOTHING`,
      [COMPANY_ID]
    );

    // 2. Price lists
    for (const eventCode of ['MIFB26', 'MIFB27']) {
      const ev = await client.query(
        `SELECT id FROM events WHERE company_id = $1 AND code = $2`, [COMPANY_ID, eventCode]
      );
      if (!ev.rows[0]) continue;
      const eventId = ev.rows[0].id;

      const existing = await client.query(
        `SELECT 1 FROM price_list WHERE company_id = $1 AND event_id = $2 LIMIT 1`,
        [COMPANY_ID, eventId]
      );
      if (existing.rows[0]) {
        console.log(`${eventCode}: price list already present, skipped.`);
        continue;
      }

      let count = 0;
      for (const tier of RATE_TIERS) {
        for (const [code, [myr, usd]] of Object.entries(TIER_PRICES[tier])) {
          await client.query(
            `INSERT INTO price_list (company_id, event_id, booth_type, sales_item_code, description, unit_price_myr, unit_price_usd)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [COMPANY_ID, eventId, tier, code, ITEM_NAMES[code], myr, usd]
          );
          count++;
        }
        // MEP (Marketing Exposure Package) can be priced differently per tier
        await client.query(
          `INSERT INTO price_list (company_id, event_id, booth_type, sales_item_code, description)
           VALUES ($1, $2, $3, 'MEP', 'Marketing Exposure Package')`,
          [COMPANY_ID, eventId, tier]
        );
        count++;
      }
      for (const item of VARIABLE_ITEMS) {
        await client.query(
          `INSERT INTO price_list (company_id, event_id, booth_type, sales_item_code, description, unit_price_myr, unit_price_usd)
           VALUES ($1, $2, 'ALL TIERS', $3, $4, NULL, NULL)`,
          [COMPANY_ID, eventId, item.code, item.description]
        );
        count++;
      }
      console.log(`${eventCode}: seeded ${count} price list rows.`);
    }

    await client.query('COMMIT');
    console.log('MIFB27 setup complete.');
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
