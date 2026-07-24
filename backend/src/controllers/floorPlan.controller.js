const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { pool } = require('../config/db');
const { pdfToPng, extractBoothCandidates } = require('../utils/pdfFloorPlan');

// The real scanned floor plan (from the hall contractor, usually exported
// out of Illustrator as a high-res PDF/image) — stored so booths can be
// positioned as an overlay on top of it. Same disk-storage pattern as
// contract attachments: random filename, original name never trusted as a
// path, gitignored uploads dir.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'floor-plans');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const random = crypto.randomBytes(16).toString('hex');
    cb(null, `${random}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // AI (Adobe Illustrator) files aren't a web-displayable format — the
    // exhibitor-facing workflow here is upload the PDF/PNG export instead
    // (the same file Operations already prints for reference), not the .ai
    // source. PDF gets converted to an image server-side on upload.
    if (!/^image\//.test(file.mimetype) && file.mimetype !== 'application/pdf') {
      return cb(new Error('Only image files (PNG/JPG) or a PDF export are accepted — not the Illustrator (.ai) source file.'));
    }
    cb(null, true);
  },
});

// ---------------------------------------------------------------------------
// Halls
// ---------------------------------------------------------------------------
async function listHalls(req, res) {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required.' });

  const result = await pool.query(
    `SELECT h.id, h.name, h.background_filename, h.background_original_filename, h.source_pdf_filename, h.created_at,
            (SELECT COUNT(*) FROM floor_plan_booths b WHERE b.hall_id = h.id) AS booth_count,
            (SELECT COUNT(*) FROM floor_plan_booths b WHERE b.hall_id = h.id
               AND (b.status = 'RESERVED' OR b.opportunity_id IS NOT NULL OR b.sales_order_id IS NOT NULL)) AS occupied_count
     FROM floor_plan_halls h
     WHERE h.company_id = $1 AND h.event_id = $2
     ORDER BY h.name`,
    [req.companyId, event_id]
  );
  res.json({ halls: result.rows });
}

async function createHall(req, res) {
  const { event_id, name } = req.body;
  if (!event_id || !name) return res.status(400).json({ error: 'event_id and name are required.' });

  const result = await pool.query(
    `INSERT INTO floor_plan_halls (company_id, event_id, name) VALUES ($1, $2, $3) RETURNING id`,
    [req.companyId, event_id, name]
  );
  res.status(201).json({ hall: { id: result.rows[0].id } });
}

async function deleteHall(req, res) {
  const result = await pool.query(
    `DELETE FROM floor_plan_halls WHERE id = $1 AND company_id = $2 RETURNING background_filename, source_pdf_filename`,
    [req.params.id, req.companyId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Hall not found.' });
  if (result.rows[0].background_filename) {
    fs.unlink(path.join(UPLOAD_DIR, result.rows[0].background_filename), () => {});
  }
  if (result.rows[0].source_pdf_filename) {
    fs.unlink(path.join(UPLOAD_DIR, result.rows[0].source_pdf_filename), () => {});
  }
  res.json({ success: true });
}

async function uploadHallImage(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });

  const existing = await pool.query(
    `SELECT background_filename, source_pdf_filename FROM floor_plan_halls WHERE id = $1 AND company_id = $2`,
    [req.params.id, req.companyId]
  );
  if (!existing.rows[0]) {
    fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: 'Hall not found.' });
  }

  let backgroundFilename = req.file.filename;
  let sourcePdfFilename = null;
  if (req.file.mimetype === 'application/pdf') {
    sourcePdfFilename = req.file.filename;
    try {
      const pngPath = await pdfToPng(req.file.path, path.join(UPLOAD_DIR, crypto.randomBytes(16).toString('hex')));
      backgroundFilename = path.basename(pngPath);
    } catch (err) {
      fs.unlink(req.file.path, () => {});
      return res.status(500).json({ error: err.message });
    }
  }

  await pool.query(
    `UPDATE floor_plan_halls SET background_filename = $1, background_original_filename = $2, source_pdf_filename = $3 WHERE id = $4`,
    [backgroundFilename, req.file.originalname, sourcePdfFilename, req.params.id]
  );
  if (existing.rows[0].background_filename) {
    fs.unlink(path.join(UPLOAD_DIR, existing.rows[0].background_filename), () => {});
  }
  if (existing.rows[0].source_pdf_filename) {
    fs.unlink(path.join(UPLOAD_DIR, existing.rows[0].source_pdf_filename), () => {});
  }
  res.json({ success: true, convertedFromPdf: !!sourcePdfFilename });
}

// Reads the hall's original PDF (kept from upload) and creates a first-pass
// booth list from whatever looks like booth numbers in its text layer —
// real numbers at real positions, not manual data entry from scratch. Sizes
// are a uniform estimate (median label spacing); irregular/merged blocks
// still need a manual pass afterward in the booth table below.
async function autoDetectBooths(req, res) {
  const hallResult = await pool.query(
    `SELECT source_pdf_filename FROM floor_plan_halls WHERE id = $1 AND company_id = $2`,
    [req.params.id, req.companyId]
  );
  const hall = hallResult.rows[0];
  if (!hall) return res.status(404).json({ error: 'Hall not found.' });
  if (!hall.source_pdf_filename) {
    return res.status(400).json({ error: 'This hall\'s background wasn\'t uploaded as a PDF, so there\'s no text layer to read booth numbers from.' });
  }

  let candidates;
  try {
    ({ booths: candidates } = await extractBoothCandidates(path.join(UPLOAD_DIR, hall.source_pdf_filename)));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  if (candidates.length === 0) {
    return res.json({ created: 0, found: 0 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let created = 0;
    for (const b of candidates) {
      const result = await client.query(
        `INSERT INTO floor_plan_booths (hall_id, booth_no, x_pct, y_pct, width_pct, height_pct)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (hall_id, booth_no) DO NOTHING
         RETURNING id`,
        [req.params.id, b.booth_no, b.x_pct, b.y_pct, b.width_pct, b.height_pct]
      );
      if (result.rows[0]) created++;
    }
    await client.query('COMMIT');
    res.json({ created, found: candidates.length });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getHallImage(req, res) {
  const result = await pool.query(
    `SELECT background_filename, background_original_filename FROM floor_plan_halls WHERE id = $1 AND company_id = $2`,
    [req.params.id, req.companyId]
  );
  const hall = result.rows[0];
  if (!hall || !hall.background_filename) return res.status(404).json({ error: 'No image uploaded for this hall.' });
  res.sendFile(path.join(UPLOAD_DIR, hall.background_filename));
}

// ---------------------------------------------------------------------------
// Booths
// ---------------------------------------------------------------------------
async function listBooths(req, res) {
  const hallCheck = await pool.query(
    `SELECT id FROM floor_plan_halls WHERE id = $1 AND company_id = $2`,
    [req.params.id, req.companyId]
  );
  if (!hallCheck.rows[0]) return res.status(404).json({ error: 'Hall not found.' });

  // PROPOSED/SOLD are computed here, not stored — SOLD requires the linked
  // contract to actually be APPROVED (per the user's own definition: "sold"
  // means the contract is fully approved for invoice, not merely created),
  // so a Draft/Pending contract with a picked booth still reads as PROPOSED
  // until it clears approval. The exhibitor name shown is the real company
  // name off whichever record owns the booth, not the old free-text field.
  const result = await pool.query(
    `SELECT b.*,
            ex_so.company_name AS sales_order_exhibitor_name,
            ex_opp.company_name AS opportunity_exhibitor_name,
            so.status AS sales_order_status,
            CASE
              WHEN b.sales_order_id IS NOT NULL AND so.status = 'APPROVED' THEN 'SOLD'
              WHEN b.sales_order_id IS NOT NULL OR b.opportunity_id IS NOT NULL THEN 'PROPOSED'
              ELSE b.status
            END AS computed_status,
            COALESCE(ex_so.company_name, ex_opp.company_name) AS exhibitor_display_name,
            COALESCE(so.salesperson_id, opp.salesperson_id) AS assigned_salesperson_id
     FROM floor_plan_booths b
     LEFT JOIN sales_orders so ON so.id = b.sales_order_id
     LEFT JOIN exhibitors ex_so ON ex_so.id = so.exhibitor_id
     LEFT JOIN opportunities opp ON opp.id = b.opportunity_id
     LEFT JOIN exhibitors ex_opp ON ex_opp.id = opp.exhibitor_id
     WHERE b.hall_id = $1
     ORDER BY b.sort_order, b.booth_no`,
    [req.params.id]
  );
  res.json({ booths: result.rows });
}

const BOOTH_FIELDS = [
  'booth_no', 'x_pct', 'y_pct', 'width_pct', 'height_pct', 'sqm',
  'is_corner', 'is_loading', 'status', 'sales_order_id', 'opportunity_id', 'assigned_exhibitor_name', 'fascia_name', 'notes', 'sort_order',
];

// Booths edited directly here (not through the Opportunity/Contract picker)
// are the source of truth going the other way too — releasing or
// reassigning a booth that was linked clears that Hall/Booth No/Dimension
// off whichever record it belonged to, per real testing: a booth shouldn't
// silently keep showing as taken by a deal that no longer holds it, and a
// contract/opportunity shouldn't silently keep showing a booth number that
// Operations has since freed up.
async function cascadeReleaseIfNeeded(client, companyId, boothId, beforeRow, fields) {
  const releasing = ('opportunity_id' in fields && fields.opportunity_id !== beforeRow.opportunity_id)
    || ('sales_order_id' in fields && fields.sales_order_id !== beforeRow.sales_order_id);
  if (!releasing) return;

  if (beforeRow.opportunity_id) {
    await client.query(`UPDATE opportunities SET hall = NULL, booth_no = NULL, dimension = NULL WHERE id = $1 AND company_id = $2`, [beforeRow.opportunity_id, companyId]);
  }
  if (beforeRow.sales_order_id) {
    await client.query(`UPDATE sales_orders SET hall = NULL, booth_no = NULL, dimension = NULL WHERE id = $1 AND company_id = $2`, [beforeRow.sales_order_id, companyId]);
  }
  if (!('opportunity_id' in fields)) await client.query(`UPDATE floor_plan_booths SET opportunity_id = NULL WHERE id = $1`, [boothId]);
  if (!('sales_order_id' in fields)) await client.query(`UPDATE floor_plan_booths SET sales_order_id = NULL WHERE id = $1`, [boothId]);
  // The fascia name belongs to the assignment, not the booth — a released
  // booth must not keep showing the previous exhibitor's fascia text.
  await client.query(`UPDATE floor_plan_booths SET fascia_name = NULL, assigned_exhibitor_name = NULL WHERE id = $1`, [boothId]);
}

async function createBooth(req, res) {
  const hallCheck = await pool.query(
    `SELECT id FROM floor_plan_halls WHERE id = $1 AND company_id = $2`,
    [req.params.id, req.companyId]
  );
  if (!hallCheck.rows[0]) return res.status(404).json({ error: 'Hall not found.' });

  const { booth_no, x_pct, y_pct, width_pct, height_pct } = req.body;
  if (!booth_no || [x_pct, y_pct, width_pct, height_pct].some((v) => v === undefined || v === '')) {
    return res.status(400).json({ error: 'booth_no, x_pct, y_pct, width_pct and height_pct are required.' });
  }

  const fields = {};
  for (const f of BOOTH_FIELDS) if (f in req.body) fields[f] = req.body[f] === '' ? null : req.body[f];
  const columns = Object.keys(fields);

  try {
    const result = await pool.query(
      `INSERT INTO floor_plan_booths (hall_id, ${columns.join(', ')})
       VALUES ($1, ${columns.map((_, i) => `$${i + 2}`).join(', ')})
       RETURNING id`,
      [req.params.id, ...columns.map((c) => fields[c])]
    );
    res.status(201).json({ booth: { id: result.rows[0].id } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Booth ${booth_no} already exists in this hall.` });
    throw err;
  }
}

// Auto-generates a rectangular grid of equal-size booths in one action —
// the standard case observed on real floor plans (repeating 3x3m modules).
// Anything generated here is just a starting point in the table; Operations
// edits/splits/merges/removes individual rows afterward to match reality
// (e.g. a run of merged booths, an irregular block).
async function bulkGenerateBooths(req, res) {
  const hallCheck = await pool.query(
    `SELECT id FROM floor_plan_halls WHERE id = $1 AND company_id = $2`,
    [req.params.id, req.companyId]
  );
  if (!hallCheck.rows[0]) return res.status(404).json({ error: 'Hall not found.' });

  const {
    start_no, rows, cols, start_x_pct, start_y_pct, cell_width_pct, cell_height_pct,
    gap_x_pct = 0, gap_y_pct = 0, sqm, is_loading_edge_col,
  } = req.body;

  const required = { start_no, rows, cols, start_x_pct, start_y_pct, cell_width_pct, cell_height_pct };
  if (Object.values(required).some((v) => v === undefined || v === '')) {
    return res.status(400).json({ error: 'start_no, rows, cols, start_x_pct, start_y_pct, cell_width_pct and cell_height_pct are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = [];
    let n = Number(start_no);
    for (let r = 0; r < Number(rows); r++) {
      for (let c = 0; c < Number(cols); c++) {
        const boothNo = String(n);
        const x = Number(start_x_pct) + c * (Number(cell_width_pct) + Number(gap_x_pct));
        const y = Number(start_y_pct) + r * (Number(cell_height_pct) + Number(gap_y_pct));
        const isLoading = is_loading_edge_col ? (c === 0 || c === Number(cols) - 1) : false;
        const result = await client.query(
          `INSERT INTO floor_plan_booths (hall_id, booth_no, x_pct, y_pct, width_pct, height_pct, sqm, is_loading, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (hall_id, booth_no) DO NOTHING
           RETURNING id`,
          [req.params.id, boothNo, x, y, cell_width_pct, cell_height_pct, sqm || null, isLoading, n]
        );
        if (result.rows[0]) created.push(result.rows[0].id);
        n++;
      }
    }
    await client.query('COMMIT');
    res.status(201).json({ created: created.length });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateBooth(req, res) {
  const fields = {};
  for (const f of BOOTH_FIELDS) if (f in req.body) fields[f] = req.body[f] === '' ? null : req.body[f];
  const columns = Object.keys(fields);
  if (columns.length === 0) return res.json({ booth: { id: req.params.boothId } });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = await client.query(
      `SELECT b.opportunity_id, b.sales_order_id,
              COALESCE(so.salesperson_id, opp.salesperson_id) AS assigned_salesperson_id
       FROM floor_plan_booths b
       JOIN floor_plan_halls h ON h.id = b.hall_id
       LEFT JOIN sales_orders so ON so.id = b.sales_order_id
       LEFT JOIN opportunities opp ON opp.id = b.opportunity_id
       WHERE b.id = $1 AND b.hall_id = $2 AND h.company_id = $3`,
      [req.params.boothId, req.params.id, req.companyId]
    );
    if (!before.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booth not found.' });
    }

    // Booth editing rights (per user rules, 2026-07-23):
    // - Operations/Admin: full editing.
    // - The salesperson whose deal holds the booth: may edit the Fascia
    //   Board name and/or release the assignment — nothing else.
    // - Everyone else: no booth changes at all.
    const beforeRow = before.rows[0];
    if (!['ADM', 'OPS'].includes(req.roleCode)) {
      const isOwner = beforeRow.assigned_salesperson_id && beforeRow.assigned_salesperson_id === req.userId;
      const allowedForOwner = ['fascia_name', 'opportunity_id', 'sales_order_id'];
      const ok = isOwner
        && columns.every((c) => allowedForOwner.includes(c))
        && (!('opportunity_id' in fields) || fields.opportunity_id === null)
        && (!('sales_order_id' in fields) || fields.sales_order_id === null);
      if (!ok) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Only Operations/Admin can edit booths; the assigned salesperson can only edit the Fascia Board name or remove their own assignment.' });
      }
    }

    const setClause = columns.map((c, i) => `${c} = $${i + 2}`).join(', ');
    try {
      await client.query(
        `UPDATE floor_plan_booths SET ${setClause} WHERE id = $1`,
        [req.params.boothId, ...columns.map((c) => fields[c])]
      );
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') return res.status(409).json({ error: 'That booth number already exists in this hall.' });
      throw err;
    }

    await cascadeReleaseIfNeeded(client, req.companyId, req.params.boothId, before.rows[0], fields);

    await client.query('COMMIT');
    res.json({ booth: { id: req.params.boothId } });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function deleteBooth(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `DELETE FROM floor_plan_booths b
       USING floor_plan_halls h
       WHERE b.id = $1 AND b.hall_id = $2 AND b.hall_id = h.id AND h.company_id = $3
       RETURNING b.opportunity_id, b.sales_order_id`,
      [req.params.boothId, req.params.id, req.companyId]
    );
    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booth not found.' });
    }

    const { opportunity_id, sales_order_id } = result.rows[0];
    if (opportunity_id) {
      await client.query(`UPDATE opportunities SET hall = NULL, booth_no = NULL, dimension = NULL WHERE id = $1 AND company_id = $2`, [opportunity_id, req.companyId]);
    }
    if (sales_order_id) {
      await client.query(`UPDATE sales_orders SET hall = NULL, booth_no = NULL, dimension = NULL WHERE id = $1 AND company_id = $2`, [sales_order_id, req.companyId]);
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  upload,
  listHalls, createHall, deleteHall, uploadHallImage, getHallImage,
  listBooths, createBooth, bulkGenerateBooths, autoDetectBooths, updateBooth, deleteBooth,
};
