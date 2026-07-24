// One-off: load the MIFB 2026 Hall 7 PDF as a floor-plan hall under the
// MIFB26 event, using the exact same conversion + auto-detect pipeline as
// the Floor Plan screen's upload button (pdfToPng + extractBoothCandidates).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool } = require('../src/config/db');
const { pdfToPng, extractBoothCandidates } = require('../src/utils/pdfFloorPlan');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'floor-plans');
const SOURCE_PDF = process.argv[2];
const EVENT_CODE = process.argv[3] || 'MIFB26';
const HALL_NAME = process.argv[4] || 'Hall 7';

async function main() {
  if (!SOURCE_PDF || !fs.existsSync(SOURCE_PDF)) throw new Error(`PDF not found: ${SOURCE_PDF}`);
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const ev = await pool.query(`SELECT id, company_id FROM events WHERE code = $1`, [EVENT_CODE]);
  if (!ev.rows[0]) throw new Error(`Event ${EVENT_CODE} not found`);
  const { id: eventId, company_id: companyId } = ev.rows[0];

  const dup = await pool.query(
    `SELECT id FROM floor_plan_halls WHERE company_id = $1 AND event_id = $2 AND name = $3`,
    [companyId, eventId, HALL_NAME]
  );
  if (dup.rows[0]) throw new Error(`${HALL_NAME} already exists under ${EVENT_CODE} — aborting, nothing changed.`);

  // Same storage convention as the upload endpoint: random on-disk names.
  const pdfFilename = crypto.randomBytes(16).toString('hex');
  const pdfPath = path.join(UPLOAD_DIR, pdfFilename);
  fs.copyFileSync(SOURCE_PDF, pdfPath);
  const pngPath = await pdfToPng(pdfPath, path.join(UPLOAD_DIR, crypto.randomBytes(16).toString('hex')));

  const hall = await pool.query(
    `INSERT INTO floor_plan_halls (company_id, event_id, name, background_filename, background_original_filename, source_pdf_filename)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [companyId, eventId, HALL_NAME, path.basename(pngPath), path.basename(SOURCE_PDF), pdfFilename]
  );
  const hallId = hall.rows[0].id;

  const { booths } = await extractBoothCandidates(pdfPath);
  let created = 0;
  for (const b of booths) {
    const r = await pool.query(
      `INSERT INTO floor_plan_booths (hall_id, booth_no, x_pct, y_pct, width_pct, height_pct)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (hall_id, booth_no) DO NOTHING RETURNING id`,
      [hallId, b.booth_no, b.x_pct, b.y_pct, b.width_pct, b.height_pct]
    );
    if (r.rows[0]) created++;
  }
  console.log(`${HALL_NAME} created under ${EVENT_CODE} (hall ${hallId}): ${created} booths auto-detected of ${booths.length} candidates.`);
  await pool.end();
}

main().catch((err) => { console.error(err.message); process.exit(1); });
