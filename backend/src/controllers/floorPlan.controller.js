const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { pool } = require('../config/db');
const { pdfToPng, extractBoothCandidates } = require('../utils/pdfFloorPlan');
const { promotePrimaryClaimants, releaseClaim } = require('../utils/floorPlanClaims');
const { syncBoothFieldsAndMirror } = require('../utils/opportunitySync');

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
    // Booth counts AND sqm, total vs allocated — the Floor Plan is now the
    // single source of truth for booth allocation, so each hall shows how
    // much of its own space is actually taken (see the hall header in
    // FloorPlan.jsx). "Allocated" uses the same definition as
    // occupied_count: reserved, or claimed by an Opportunity/Contract.
    `SELECT h.id, h.name, h.background_filename, h.background_original_filename, h.source_pdf_filename, h.created_at,
            (SELECT COUNT(*) FROM floor_plan_booths b WHERE b.hall_id = h.id) AS booth_count,
            (SELECT COUNT(*) FROM floor_plan_booths b WHERE b.hall_id = h.id
               AND (b.status = 'RESERVED' OR b.opportunity_id IS NOT NULL OR b.sales_order_id IS NOT NULL)) AS occupied_count,
            (SELECT COALESCE(SUM(b.sqm), 0) FROM floor_plan_booths b WHERE b.hall_id = h.id) AS total_sqm,
            (SELECT COALESCE(SUM(b.sqm), 0) FROM floor_plan_booths b WHERE b.hall_id = h.id
               AND (b.status = 'RESERVED' OR b.opportunity_id IS NOT NULL OR b.sales_order_id IS NOT NULL)) AS occupied_sqm,
            -- Sold vs merely proposed, split out — "allocated" on its own
            -- overstates how much is actually committed, since a proposal
            -- can still fall through. A Contract link outranks an
            -- Opportunity link on the same booth (same precedence the map
            -- and every report use).
            (SELECT COUNT(*) FROM floor_plan_booths b WHERE b.hall_id = h.id
               AND b.sales_order_id IS NOT NULL) AS sold_count,
            (SELECT COALESCE(SUM(b.sqm), 0) FROM floor_plan_booths b WHERE b.hall_id = h.id
               AND b.sales_order_id IS NOT NULL) AS sold_sqm,
            (SELECT COUNT(*) FROM floor_plan_booths b WHERE b.hall_id = h.id
               AND b.sales_order_id IS NULL AND b.opportunity_id IS NOT NULL) AS proposed_count,
            (SELECT COALESCE(SUM(b.sqm), 0) FROM floor_plan_booths b WHERE b.hall_id = h.id
               AND b.sales_order_id IS NULL AND b.opportunity_id IS NOT NULL) AS proposed_sqm,
            -- Booths with no sqm captured yet. Without surfacing this, a
            -- hall where only the sold booths have sqm reads as "100%
            -- allocated" when really the capacity denominator is unknown —
            -- the percentage is arithmetically right but badly misleading.
            (SELECT COUNT(*) FROM floor_plan_booths b WHERE b.hall_id = h.id
               AND (b.sqm IS NULL OR b.sqm = 0)) AS booths_without_sqm
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
  const hallCheck = await pool.query(`SELECT id FROM floor_plan_halls WHERE id = $1 AND company_id = $2`, [req.params.id, req.companyId]);
  if (!hallCheck.rows[0]) return res.status(404).json({ error: 'Hall not found.' });

  // Same reasoning as deleteBooth — never silently take a whole hall (and
  // every booth in it) out from under live deals.
  const occupied = await pool.query(
    `SELECT b.booth_no, COALESCE(ex_so.company_name, ex_opp.company_name) AS exhibitor_name
     FROM floor_plan_booths b
     LEFT JOIN sales_orders so ON so.id = b.sales_order_id
     LEFT JOIN exhibitors ex_so ON ex_so.id = so.exhibitor_id
     LEFT JOIN opportunities opp ON opp.id = b.opportunity_id
     LEFT JOIN exhibitors ex_opp ON ex_opp.id = opp.exhibitor_id
     WHERE b.hall_id = $1 AND (b.opportunity_id IS NOT NULL OR b.sales_order_id IS NOT NULL)
     ORDER BY b.booth_no`,
    [req.params.id]
  );
  if (occupied.rows.length > 0) {
    const list = occupied.rows.map((r) => `${r.booth_no} (${r.exhibitor_name || 'unknown'})`).join(', ');
    return res.status(409).json({ error: `Cannot delete this hall — ${occupied.rows.length} booth(s) still assigned: ${list}. Release them first.` });
  }
  const claimed = await pool.query(
    `SELECT DISTINCT b.booth_no
     FROM floor_plan_booths b
     JOIN floor_plan_booth_claims c ON c.booth_id = b.id
     WHERE b.hall_id = $1 AND c.released_at IS NULL
     ORDER BY b.booth_no`,
    [req.params.id]
  );
  if (claimed.rows.length > 0) {
    return res.status(409).json({ error: `Cannot delete this hall — booth(s) still being proposed by a deal: ${claimed.rows.map((r) => r.booth_no).join(', ')}. Release them first.` });
  }

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
  // PENDING_RELEASE takes priority over SOLD: a booth a Credit Note has
  // staged to give up (see credit_notes.released_booth_ids) stays flagged
  // this way while the CN is still only PENDING_APPROVAL — visibly
  // different from a normal Sold booth so other reps know it MAY open up
  // soon, without anyone being able to claim it before Management actually
  // approves the CN (nothing about the booth's real link changes until then).
  const result = await pool.query(
    `SELECT b.*,
            ex_so.company_name AS sales_order_exhibitor_name,
            ex_opp.company_name AS opportunity_exhibitor_name,
            so.status AS sales_order_status,
            CASE
              WHEN pending_cn.id IS NOT NULL THEN 'PENDING_RELEASE'
              WHEN b.sales_order_id IS NOT NULL AND so.status = 'APPROVED' THEN 'SOLD'
              WHEN b.sales_order_id IS NOT NULL OR b.opportunity_id IS NOT NULL THEN 'PROPOSED'
              ELSE b.status
            END AS computed_status,
            COALESCE(ex_so.company_name, ex_opp.company_name) AS exhibitor_display_name,
            COALESCE(so.salesperson_id, opp.salesperson_id) AS assigned_salesperson_id,
            COALESCE(ex_so.country_code, ex_opp.country_code) AS booth_country,
            COALESCE(ag_so.name, ag_opp.name) AS agent_name,
            -- Which type this specific booth was tagged as on the Floor
            -- Plan picker (see FloorPlan.jsx's per-booth type dropdown) —
            -- read off whichever claim is this booth's actual primary link.
            COALESCE(
              (SELECT c.allocated_item_code FROM floor_plan_booth_claims c
               WHERE c.booth_id = b.id AND c.record_type = 'sales_order' AND c.record_id = b.sales_order_id AND c.released_at IS NULL),
              (SELECT c.allocated_item_code FROM floor_plan_booth_claims c
               WHERE c.booth_id = b.id AND c.record_type = 'opportunity' AND c.record_id = b.opportunity_id AND c.released_at IS NULL)
            ) AS allocated_item_code,
            -- Any other admin-flagged is_booth_related item tagged on this
            -- booth (Corner/Loading stay on their own dedicated columns
            -- above — see migration 070) — used to lock Qty in Billing the
            -- same way Corner/Loading already do.
            COALESCE(
              (SELECT array_agg(a.item_code) FROM floor_plan_booth_addons a WHERE a.booth_id = b.id),
              ARRAY[]::text[]
            ) AS addon_codes,
            -- Every LIVE claim on this booth, not just the primary one.
            -- Several Opportunities can propose the same booth until a
            -- Contract is approved (competing-claims rule) — the map shows
            -- a count badge when there's more than one, and this list is
            -- what the hover tooltip breaks down.
            COALESCE((
              SELECT json_agg(json_build_object(
                       'record_type', c.record_type,
                       'exhibitor_name', COALESCE(cex_so.company_name, cex_opp.company_name),
                       'salesperson_name', COALESCE(cu_so.full_name, cu_opp.full_name),
                       'item_code', c.allocated_item_code
                     ) ORDER BY c.record_type, c.claimed_at)
              FROM floor_plan_booth_claims c
              LEFT JOIN sales_orders cso ON cso.id = c.record_id AND c.record_type = 'sales_order'
              LEFT JOIN exhibitors cex_so ON cex_so.id = cso.exhibitor_id
              LEFT JOIN users cu_so ON cu_so.id = COALESCE(cso.salesperson_id, cex_so.salesperson_id)
              LEFT JOIN opportunities copp ON copp.id = c.record_id AND c.record_type = 'opportunity'
              LEFT JOIN exhibitors cex_opp ON cex_opp.id = copp.exhibitor_id
              LEFT JOIN users cu_opp ON cu_opp.id = COALESCE(copp.salesperson_id, cex_opp.salesperson_id)
              WHERE c.booth_id = b.id AND c.released_at IS NULL
                AND COALESCE(cso.is_active, copp.is_active, TRUE) = TRUE
            ), '[]'::json) AS claims
     FROM floor_plan_booths b
     LEFT JOIN sales_orders so ON so.id = b.sales_order_id
     LEFT JOIN exhibitors ex_so ON ex_so.id = so.exhibitor_id
     LEFT JOIN agents ag_so ON ag_so.id = ex_so.agent_id
     LEFT JOIN opportunities opp ON opp.id = b.opportunity_id
     LEFT JOIN exhibitors ex_opp ON ex_opp.id = opp.exhibitor_id
     LEFT JOIN agents ag_opp ON ag_opp.id = ex_opp.agent_id
     LEFT JOIN credit_notes pending_cn
       ON pending_cn.sales_order_id = b.sales_order_id
      AND pending_cn.status = 'PENDING_APPROVAL'
      AND b.id = ANY(pending_cn.released_booth_ids)
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
  const releasingOpp = 'opportunity_id' in fields && fields.opportunity_id !== beforeRow.opportunity_id;
  const releasingSo = 'sales_order_id' in fields && fields.sales_order_id !== beforeRow.sales_order_id;
  if (!releasingOpp && !releasingSo) return;

  // Release just the claim being cleared here — releaseClaim re-derives the
  // booth's primary column from whoever's left (competing-claims rule,
  // Round 6 item 4), so a booth someone ELSE is still proposing correctly
  // stays PROPOSED under them instead of going blank.
  if (releasingOpp && beforeRow.opportunity_id) {
    await client.query(`UPDATE opportunities SET hall = NULL, booth_no = NULL, dimension = NULL WHERE id = $1 AND company_id = $2`, [beforeRow.opportunity_id, companyId]);
    await releaseClaim(client, boothId, 'opportunity', beforeRow.opportunity_id, 'RECORD_RELEASED');
  }
  if (releasingSo && beforeRow.sales_order_id) {
    await client.query(`UPDATE sales_orders SET hall = NULL, booth_no = NULL, dimension = NULL WHERE id = $1 AND company_id = $2`, [beforeRow.sales_order_id, companyId]);
    await releaseClaim(client, boothId, 'sales_order', beforeRow.sales_order_id, 'RECORD_RELEASED');
  }
  // The fascia name belongs to the assignment, not the booth — clear it
  // only if nobody's left claiming the booth at all (if releaseClaim just
  // promoted a different remaining claimant, their fascia stays valid).
  const after = await client.query(`SELECT opportunity_id, sales_order_id FROM floor_plan_booths WHERE id = $1`, [boothId]);
  if (!after.rows[0]?.opportunity_id && !after.rows[0]?.sales_order_id) {
    await client.query(`UPDATE floor_plan_booths SET fascia_name = NULL, assigned_exhibitor_name = NULL WHERE id = $1`, [boothId]);
  }
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
  const addonCodes = Array.isArray(req.body.addon_codes) ? req.body.addon_codes : null;
  if (columns.length === 0 && !addonCodes) return res.json({ booth: { id: req.params.boothId } });

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
        && !addonCodes
        && columns.every((c) => allowedForOwner.includes(c))
        && (!('opportunity_id' in fields) || fields.opportunity_id === null)
        && (!('sales_order_id' in fields) || fields.sales_order_id === null);
      if (!ok) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Only Operations/Admin can edit booths; the assigned salesperson can only edit the Fascia Board name or remove their own assignment.' });
      }
    }

    if (columns.length > 0) {
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
    }

    if (addonCodes) {
      await client.query(`DELETE FROM floor_plan_booth_addons WHERE booth_id = $1`, [req.params.boothId]);
      for (const code of addonCodes) {
        await client.query(
          `INSERT INTO floor_plan_booth_addons (company_id, booth_id, item_code) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [req.companyId, req.params.boothId, code]
        );
      }
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

// Batch-edit Sqm/Corner/Loading/Fascia/Notes across many booths at once —
// Operations otherwise has to open the single-booth floating editor per row,
// which doesn't scale when a whole block needs the same sqm or a shared
// note. Deliberately a narrow field set (never opportunity_id/sales_order_id
// or geometry) so this can't be used to mass-reassign/move booths, and never
// needs the cascade-release logic updateBooth carries for link changes.
const BULK_EDIT_FIELDS = ['sqm', 'is_corner', 'is_loading', 'fascia_name', 'notes'];

async function bulkUpdateBooths(req, res) {
  if (!['ADM', 'OPS'].includes(req.roleCode)) {
    return res.status(403).json({ error: 'Only Operations/Admin can bulk-edit booths.' });
  }

  const { booth_ids } = req.body;
  if (!Array.isArray(booth_ids) || booth_ids.length === 0) {
    return res.status(400).json({ error: 'booth_ids (non-empty array) is required.' });
  }

  const fields = {};
  for (const f of BULK_EDIT_FIELDS) {
    if (f in req.body && req.body[f] !== '') fields[f] = req.body[f];
  }
  const columns = Object.keys(fields);
  if (columns.length === 0) {
    return res.status(400).json({ error: 'Provide at least one of sqm, is_corner, is_loading, fascia_name, notes to apply.' });
  }

  const setClause = columns.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const result = await pool.query(
    `UPDATE floor_plan_booths b SET ${setClause}
     FROM floor_plan_halls h
     WHERE b.hall_id = h.id AND h.company_id = $1 AND b.id = ANY($${columns.length + 2}::uuid[])
     RETURNING b.id`,
    [req.companyId, ...columns.map((c) => fields[c]), booth_ids]
  );
  res.json({ updated: result.rows.length });
}

async function deleteBooth(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Deleting a booth that's still assigned/proposed used to silently blank
    // out the linked Opportunity/Contract's Hall/Booth No/Dimension with no
    // warning — a real destructive-data-loss risk (2026-08-01 user request:
    // block it instead, and say exactly who's holding the booth, so
    // Operations releases the link first rather than the booth just
    // vanishing out from under a live deal).
    const check = await client.query(
      `SELECT b.booth_no, COALESCE(ex_so.company_name, ex_opp.company_name) AS exhibitor_name
       FROM floor_plan_booths b
       JOIN floor_plan_halls h ON h.id = b.hall_id
       LEFT JOIN sales_orders so ON so.id = b.sales_order_id
       LEFT JOIN exhibitors ex_so ON ex_so.id = so.exhibitor_id
       LEFT JOIN opportunities opp ON opp.id = b.opportunity_id
       LEFT JOIN exhibitors ex_opp ON ex_opp.id = opp.exhibitor_id
       WHERE b.id = $1 AND b.hall_id = $2 AND h.company_id = $3
       FOR UPDATE OF b`,
      [req.params.boothId, req.params.id, req.companyId]
    );
    if (!check.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booth not found.' });
    }
    if (check.rows[0].exhibitor_name) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Cannot delete booth ${check.rows[0].booth_no} — it's currently assigned to ${check.rows[0].exhibitor_name}. Release that link (from the booth editor, or the Opportunity/Contract) first.` });
    }
    // A booth can also carry an active claim without being the PRIMARY
    // claimant column above (competing-claims rule, Round 6 item 4).
    const claim = await client.query(
      `SELECT COALESCE(ex_opp.company_name, ex_so.company_name) AS exhibitor_name
       FROM floor_plan_booth_claims c
       LEFT JOIN opportunities opp ON opp.id = c.record_id AND c.record_type = 'opportunity'
       LEFT JOIN exhibitors ex_opp ON ex_opp.id = opp.exhibitor_id
       LEFT JOIN sales_orders so ON so.id = c.record_id AND c.record_type = 'sales_order'
       LEFT JOIN exhibitors ex_so ON ex_so.id = so.exhibitor_id
       WHERE c.booth_id = $1 AND c.released_at IS NULL LIMIT 1`,
      [req.params.boothId]
    );
    if (claim.rows[0]?.exhibitor_name) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Cannot delete this booth — it's currently being proposed by ${claim.rows[0].exhibitor_name}. Release that link first.` });
    }

    await client.query(
      `DELETE FROM floor_plan_booths b
       USING floor_plan_halls h
       WHERE b.id = $1 AND b.hall_id = $2 AND b.hall_id = h.id AND h.company_id = $3`,
      [req.params.boothId, req.params.id, req.companyId]
    );

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// --- Multi-booth support --------------------------------------------------
// A contract/opportunity can hold more than one physical booth (e.g. a
// 1000 sqm deal spanning 100+ individual booths), AND — since Round 6 item
// 4 — a still-unsold ("Proposed") booth can be claimed by more than one
// Opportunity/draft Contract at once. floor_plan_booth_claims (see
// floorPlanClaims.js) is the real source of truth for "what does record X
// currently have picked"; floor_plan_booths.opportunity_id/sales_order_id
// stay as the single "primary/displayed claimant" column each, re-derived
// by promotePrimaryClaimants any time a claim changes.
//
// recordType is fixed at route-registration time below ('opportunity' or
// 'sales_order', never user input) — safe to use directly in these queries.
function listRecordBooths(recordType) {
  return async function (req, res) {
    const result = await pool.query(
      `SELECT b.*, h.name AS hall_name, c.allocated_item_code,
              COALESCE(
                (SELECT array_agg(a.item_code) FROM floor_plan_booth_addons a WHERE a.booth_id = b.id),
                ARRAY[]::text[]
              ) AS addon_codes
       FROM floor_plan_booth_claims c
       JOIN floor_plan_booths b ON b.id = c.booth_id
       JOIN floor_plan_halls h ON h.id = b.hall_id
       WHERE c.record_type = $1 AND c.record_id = $2 AND c.released_at IS NULL AND h.company_id = $3
       ORDER BY h.name, b.booth_no`,
      [recordType, req.params.id, req.companyId]
    );
    res.json({ booths: result.rows });
  };
}

// Booth mass pickup — replaces the record's ENTIRE claimed booth set in one
// shot with whatever was staged on the Floor Plan's sqm-capped picker
// (FloorPlan.jsx's 'cap' pickFor mode). parentTable supplies the total_sqm
// cap to re-check server-side (the picker already enforces it client-side,
// but that's just UX — this is the real gate). A booth already claimed by
// ANOTHER record is only blocked if it's genuinely SOLD (an APPROVED
// contract owns it) or manually Reserved by Operations — otherwise several
// Opportunities/draft Contracts may propose it at once; whichever gets its
// Contract approved first wins it for real (see approveSalesOrder), and
// every other active claim on it is auto-released with the losing Sales
// user notified to re-pick.
// Canonical, order-independent fingerprint of a booth set's billing-relevant
// "shape" — sqm per allocated item type, corner/loading counts, addon
// counts. Two sets with the same shape produce identical billing given unit
// prices are fixed and Qty is 100% booth-driven — used to gate booth
// reassignment on an already-APPROVED contract without re-deriving the
// actual dollar totals (2026-08-01, item 3).
function boothShape(rows) {
  const itemSqm = {};
  let cornerCount = 0;
  let loadingCount = 0;
  const addonCount = {};
  for (const r of rows) {
    const key = r.allocated_item_code || '__DEFAULT__';
    itemSqm[key] = (itemSqm[key] || 0) + (Number(r.sqm) || 0);
    if (r.is_corner) cornerCount++;
    if (r.is_loading) loadingCount++;
    for (const code of (r.addon_codes || [])) {
      addonCount[code] = (addonCount[code] || 0) + 1;
    }
  }
  return JSON.stringify({
    itemSqm: Object.keys(itemSqm).sort().map((k) => `${k}:${itemSqm[k]}`),
    cornerCount,
    loadingCount,
    addonCount: Object.keys(addonCount).sort().map((k) => `${k}:${addonCount[k]}`),
  });
}

function bulkSetRecordBooths(recordType, parentTable, linkColumn) {
  return async function (req, res) {
    const ids = Array.isArray(req.body.floor_plan_booth_ids) ? req.body.floor_plan_booth_ids : null;
    if (!ids) return res.status(400).json({ error: 'floor_plan_booth_ids must be an array.' });
    // Which booth is Bare Space vs which upgrade tier (see FloorPlan.jsx's
    // per-booth type tagging in the cap-mode picker) — keyed by booth id,
    // values are sales_item_codes ('BAS', 'SSS', etc.) or omitted/null for
    // untagged (treated as Bare Space).
    const itemCodes = req.body.booth_item_codes && typeof req.body.booth_item_codes === 'object'
      ? req.body.booth_item_codes : {};

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const parent = await client.query(
        `SELECT id FROM ${parentTable} WHERE id = $1 AND company_id = $2 FOR UPDATE`,
        [req.params.id, req.companyId]
      );
      if (!parent.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Record not found.' });
      }

      // Once a Contract is APPROVED, "Reassign Booth" is only for moving the
      // exhibitor to a same-value spot — any change to sqm/upgrade
      // tier/corner/loading has to go through Request Value Change instead,
      // since that's the flow that actually routes for approval (2026-08-01
      // item 3). Enforced here (not just in the UI) so it can't be bypassed
      // by calling the picker directly. Compares booth "shape" rather than
      // re-deriving dollar totals — equivalent given unit prices are fixed
      // and Qty is 100% booth-driven, and avoids duplicating billing logic.
      let approvedContractGate = false;
      if (parentTable === 'sales_orders') {
        const soStatus = await client.query(`SELECT status FROM sales_orders WHERE id = $1`, [req.params.id]);
        approvedContractGate = soStatus.rows[0]?.status === 'APPROVED';
      }

      if (ids.length > 0) {
        const target = await client.query(
          `SELECT b.id, b.sqm, b.status, b.is_corner, b.is_loading, so.status AS sales_order_status,
                  COALESCE((SELECT array_agg(a.item_code ORDER BY a.item_code) FROM floor_plan_booth_addons a WHERE a.booth_id = b.id), ARRAY[]::text[]) AS addon_codes
           FROM floor_plan_booths b
           JOIN floor_plan_halls h ON h.id = b.hall_id
           LEFT JOIN sales_orders so ON so.id = b.sales_order_id
           WHERE b.id = ANY($1::uuid[]) AND h.company_id = $2
           FOR UPDATE OF b`,
          [ids, req.companyId]
        );
        if (target.rows.length !== ids.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'One or more selected booths no longer exist.' });
        }
        const sold = target.rows.find((b) => b.sales_order_status === 'APPROVED');
        if (sold) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'One or more selected booths have already been sold — please review your selection.' });
        }
        const reserved = target.rows.find((b) => b.status === 'RESERVED');
        if (reserved) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'One or more selected booths are Reserved — please review your selection.' });
        }
        // No sqm-cap check here on purpose: Total Sqm is DERIVED from
        // whichever booths get linked (see recomputeCachedBoothFields
        // below), not an independent target this call has to respect. A
        // prior version compared the newly-proposed booth set's sqm against
        // the record's own CURRENT total_sqm — which this same call is
        // about to overwrite — making it structurally impossible to ever
        // grow a booth selection (adding any booth always "exceeded" the
        // not-yet-updated old total). Confirmed as a real bug via a live
        // repro (2026-07-31): trying to add a 3rd booth to an
        // already-2-booth opportunity was unconditionally rejected. The
        // picker's own client-side cap (FloorPlan.jsx's handleCapToggle)
        // already never fires here since callers pass cap: null for this
        // derived-total flow — this server-side check was the last
        // leftover from the pre-#133/#156 "manually-typed target sqm"
        // architecture and is now purely obsolete.

        if (approvedContractGate) {
          const newRows = target.rows.map((r) => ({ ...r, allocated_item_code: itemCodes[r.id] || null }));
          const oldRows = (await client.query(
            `SELECT b.sqm, b.is_corner, b.is_loading, c.allocated_item_code,
                    COALESCE((SELECT array_agg(a.item_code ORDER BY a.item_code) FROM floor_plan_booth_addons a WHERE a.booth_id = b.id), ARRAY[]::text[]) AS addon_codes
             FROM floor_plan_booth_claims c
             JOIN floor_plan_booths b ON b.id = c.booth_id
             WHERE c.record_type = $1 AND c.record_id = $2 AND c.released_at IS NULL`,
            [recordType, req.params.id]
          )).rows;
          if (boothShape(oldRows) !== boothShape(newRows)) {
            await client.query('ROLLBACK');
            return res.status(409).json({
              error: 'This booth selection would change the contract value — an approved contract can only be reassigned to a same-value booth (same sqm, upgrade tier, and corner/loading). Use "Request Value Change" instead if the value itself needs to change.',
            });
          }
        }
      } else if (approvedContractGate) {
        // Deselecting every booth on an approved contract is itself a value
        // change (down to zero) — same gate, just with an empty new set.
        const oldRows = (await client.query(
          `SELECT b.sqm, b.is_corner, b.is_loading, c.allocated_item_code,
                  COALESCE((SELECT array_agg(a.item_code ORDER BY a.item_code) FROM floor_plan_booth_addons a WHERE a.booth_id = b.id), ARRAY[]::text[]) AS addon_codes
           FROM floor_plan_booth_claims c
           JOIN floor_plan_booths b ON b.id = c.booth_id
           WHERE c.record_type = $1 AND c.record_id = $2 AND c.released_at IS NULL`,
          [recordType, req.params.id]
        )).rows;
        if (oldRows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: 'This booth selection would change the contract value — an approved contract can only be reassigned to a same-value booth. Use "Request Value Change" instead if the value itself needs to change.',
          });
        }
      }

      // Release whatever this record claimed that's NOT in the new set, and
      // re-derive each released booth's primary claimant from whoever's
      // left (may still be someone else's active claim).
      const released = await client.query(
        `UPDATE floor_plan_booth_claims c SET released_at = now(), release_reason = 'USER_DESELECTED'
         FROM floor_plan_booths b JOIN floor_plan_halls h ON h.id = b.hall_id
         WHERE c.booth_id = b.id AND h.company_id = $1
           AND c.record_type = $2 AND c.record_id = $3 AND c.released_at IS NULL
           AND NOT (c.booth_id = ANY($4::uuid[]))
         RETURNING c.booth_id`,
        [req.companyId, recordType, req.params.id, ids]
      );
      await promotePrimaryClaimants(client, released.rows.map((r) => r.booth_id));

      if (ids.length > 0) {
        // ON CONFLICT DO UPDATE (not DO NOTHING) so re-tagging a booth this
        // record already claimed — without deselecting/reselecting it —
        // still updates its allocated type.
        await client.query(
          `INSERT INTO floor_plan_booth_claims (company_id, booth_id, record_type, record_id, allocated_item_code)
           SELECT $1, x.id, $2, $3, $5::jsonb ->> x.id::text FROM unnest($4::uuid[]) AS x(id)
           ON CONFLICT (booth_id, record_type, record_id) WHERE released_at IS NULL
           DO UPDATE SET allocated_item_code = EXCLUDED.allocated_item_code`,
          [req.companyId, recordType, req.params.id, ids, JSON.stringify(itemCodes)]
        );
        // A booth with no primary claimant yet becomes this record's (the
        // common case: nobody else was proposing it). If someone else is
        // already primary, they stay primary — this is now just an
        // additional competing claim, not a takeover.
        await client.query(
          `UPDATE floor_plan_booths SET ${linkColumn} = $1, assigned_exhibitor_name = COALESCE(assigned_exhibitor_name, $2)
           WHERE id = ANY($3::uuid[]) AND opportunity_id IS NULL AND sales_order_id IS NULL`,
          [req.params.id, req.body.exhibitor_name || null, ids]
        );
        // The user has actively gone back into the picker and committed a
        // selection — clear the persistent "please allocate ASAP" banner
        // (see getOpportunity/getSalesOrder's needs_booth_reallocation) even
        // if the new total doesn't exactly match the old one; picking
        // nothing new (ids.length === 0) does NOT clear it, since that's
        // not a real replacement.
        await client.query(
          `UPDATE floor_plan_booth_claims SET reallocated_at = now()
           WHERE record_type = $1 AND record_id = $2 AND release_reason = 'LOST_TO_APPROVAL' AND reallocated_at IS NULL`,
          [recordType, req.params.id]
        );
      }

      // Mirror this record's own claimed set onto its Hall/Booth No/Total
      // Sqm columns too — not just left for the user's next Save — so
      // anything that reads them directly (list screens, print docs) is
      // correct immediately, even if the user navigates away from the Floor
      // Plan without saving the Opportunity/Contract afterward.
      const final = await client.query(
        `SELECT b.*, h.name AS hall_name, c.allocated_item_code
         FROM floor_plan_booth_claims c
         JOIN floor_plan_booths b ON b.id = c.booth_id
         JOIN floor_plan_halls h ON h.id = b.hall_id
         WHERE c.record_type = $1 AND c.record_id = $2 AND c.released_at IS NULL AND h.company_id = $3
         ORDER BY h.name, b.booth_no`,
        [recordType, req.params.id, req.companyId]
      );
      // For a Contract, this also mirrors the refreshed Hall/Booth No/Total
      // Sqm (and booth-driven billing rows) onto its linked Opportunity in
      // the same transaction — Change Booth used to skip this entirely,
      // leaving the Opportunity showing the pre-change booth set/sqm even
      // though the Contract itself was correct (2026-08-01 user report).
      await syncBoothFieldsAndMirror(client, req.companyId, recordType, req.params.id);

      await client.query('COMMIT');
      res.json({ booths: final.rows });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };
}

// Clears the "you lost a booth to another approved contract" Task To-Do
// item(s) for one record — bulk-acknowledges every one of its unacknowledged
// LOST_TO_APPROVAL claims at once (there can be several if it lost more than
// one booth in the same approval), mirroring the acknowledge pattern used
// for invoice/CN/contract-approval notifications elsewhere.
function acknowledgeBoothLoss(recordType) {
  return async function (req, res) {
    await pool.query(
      `UPDATE floor_plan_booth_claims c SET acknowledged_by = $1, acknowledged_at = now()
       FROM floor_plan_booths b JOIN floor_plan_halls h ON h.id = b.hall_id
       WHERE c.booth_id = b.id AND h.company_id = $2
         AND c.record_type = $3 AND c.record_id = $4
         AND c.release_reason = 'LOST_TO_APPROVAL' AND c.acknowledged_at IS NULL`,
      [req.userId, req.companyId, recordType, req.params.id]
    );
    res.json({ success: true });
  };
}

module.exports = {
  upload,
  listHalls, createHall, deleteHall, uploadHallImage, getHallImage,
  listBooths, createBooth, bulkGenerateBooths, autoDetectBooths, updateBooth, bulkUpdateBooths, deleteBooth,
  listRecordBooths, bulkSetRecordBooths, acknowledgeBoothLoss,
};
