// Imports the full country list from the Excel LIST tab (columns Q/R:
// 3-letter code + name, ~230 countries). Existing countries are matched by
// name and keep their current code (the migration used 2-letter codes);
// new ones are inserted with the LIST tab's 3-letter code. Names are
// title-cased for display. Safe to re-run.
// Usage: node scripts/import-countries.js "<path-to-xlsm>"
require('dotenv').config();
const XLSX = require('xlsx');
const { pool } = require('../src/config/db');

const norm = (s) => s.toUpperCase().replace(/[^A-Z]/g, '');
const titleCase = (s) =>
  s.toLowerCase().replace(/(^|[\s\-('/])([a-zà-ÿ])/g, (m, sep, ch) => sep + ch.toUpperCase());

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node scripts/import-countries.js "<path-to-xlsm>"');
    process.exit(1);
  }

  const wb = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['LIST'], { header: 1, raw: false, defval: '' });
  const listCountries = rows.slice(2)
    .map((r) => ({ code: String(r[16]).trim(), name: String(r[17]).trim() }))
    .filter((c) => c.code && c.name);

  const client = await pool.connect();
  let inserted = 0, renamed = 0;
  try {
    await client.query('BEGIN');
    const existing = (await client.query('SELECT code, name FROM countries')).rows;
    const byNorm = new Map(existing.map((c) => [norm(c.name), c]));
    const seen = new Set();

    for (const c of listCountries) {
      const key = norm(c.name);
      if (seen.has(key)) continue; // LIST has a few repeated names
      seen.add(key);

      const pretty = titleCase(c.name);
      const current = byNorm.get(key);
      if (current) {
        if (current.name !== pretty) {
          await client.query('UPDATE countries SET name = $1 WHERE code = $2', [pretty, current.code]);
          renamed++;
        }
      } else {
        await client.query(
          'INSERT INTO countries (code, name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [c.code, pretty]
        );
        inserted++;
      }
    }
    await client.query('COMMIT');
    const total = (await client.query('SELECT count(*) FROM countries')).rows[0].count;
    console.log(`Countries: ${inserted} inserted, ${renamed} renamed for display. Total now: ${total}`);
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
