const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { pool } = require('../config/db');

// ---------------------------------------------------------------------------
// Company branding — logo, letterhead header strip, footer strip. Rendered
// on every official printed document (Contract/Proforma/Invoice/Receipt/
// Statement) so a second company selling this platform can carry their own
// identity on documents sent to their exhibitors, not ExpoCO's. Same
// disk-storage pattern as Floor Plan uploads: random on-disk filename,
// original name never trusted as a path, gitignored uploads dir.
const BRANDING_DIR = path.join(__dirname, '..', '..', 'uploads', 'branding');
fs.mkdirSync(BRANDING_DIR, { recursive: true });
const BRANDING_TYPES = ['logo', 'letterhead', 'footer'];
const BRANDING_COLUMN = { logo: 'logo_filename', letterhead: 'letterhead_filename', footer: 'footer_filename' };

const brandingStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, BRANDING_DIR),
  filename: (req, file, cb) => cb(null, `${crypto.randomBytes(16).toString('hex')}${path.extname(file.originalname)}`),
});
const uploadBranding = multer({
  storage: brandingStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('Only image files (PNG/JPG) are accepted.'));
    cb(null, true);
  },
});

async function uploadBrandingImage(req, res) {
  const { type } = req.params;
  if (!BRANDING_TYPES.includes(type)) return res.status(400).json({ error: 'Unknown branding image type.' });
  if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });

  const column = BRANDING_COLUMN[type];
  const existing = await pool.query(
    `SELECT ${column} AS filename FROM company_settings WHERE company_id = $1`,
    [req.companyId]
  );
  if (existing.rows.length === 0) {
    await pool.query(`INSERT INTO company_settings (company_id, usd_to_myr_rate) VALUES ($1, 4)`, [req.companyId]);
  }
  await pool.query(
    `UPDATE company_settings SET ${column} = $1 WHERE company_id = $2`,
    [req.file.filename, req.companyId]
  );
  if (existing.rows[0] && existing.rows[0].filename) {
    fs.unlink(path.join(BRANDING_DIR, existing.rows[0].filename), () => {});
  }
  res.json({ success: true });
}

async function deleteBrandingImage(req, res) {
  const { type } = req.params;
  if (!BRANDING_TYPES.includes(type)) return res.status(400).json({ error: 'Unknown branding image type.' });
  const column = BRANDING_COLUMN[type];

  const existing = await pool.query(
    `SELECT ${column} AS filename FROM company_settings WHERE company_id = $1`,
    [req.companyId]
  );
  await pool.query(`UPDATE company_settings SET ${column} = NULL WHERE company_id = $1`, [req.companyId]);
  if (existing.rows[0] && existing.rows[0].filename) {
    fs.unlink(path.join(BRANDING_DIR, existing.rows[0].filename), () => {});
  }
  res.json({ success: true });
}

// Session-cookie authenticated, same as every other endpoint here — an
// <img src> to a same-origin URL sends cookies automatically, so this
// doesn't need the "public read" carve-out the Floor Plan hall image uses.
// Scoped by req.companyId (from the session), never a URL param, so one
// company can never fetch another's branding images.
async function getBrandingImage(req, res) {
  const { type } = req.params;
  if (!BRANDING_TYPES.includes(type)) return res.status(400).json({ error: 'Unknown branding image type.' });
  const column = BRANDING_COLUMN[type];

  const result = await pool.query(
    `SELECT ${column} AS filename FROM company_settings WHERE company_id = $1`,
    [req.companyId]
  );
  const filename = result.rows[0] && result.rows[0].filename;
  if (!filename) return res.status(404).json({ error: 'No image uploaded.' });
  res.sendFile(path.join(BRANDING_DIR, filename));
}

// ---------------------------------------------------------------------------
// Tax codes (company-configurable — SV-6/SV-8/NTS are the seeded starting
// point, not hardcoded; kept as short codes for future accounting export)
// ---------------------------------------------------------------------------
async function listTaxCodes(req, res) {
  const result = await pool.query(
    `SELECT id, code, name, rate_pct, is_active FROM tax_codes
     WHERE company_id = $1 ORDER BY code`,
    [req.companyId]
  );
  res.json({ taxCodes: result.rows });
}

async function createTaxCode(req, res) {
  const { code, name, rate_pct } = req.body;
  if (!code || !name || rate_pct === undefined) {
    return res.status(400).json({ error: 'code, name and rate_pct are required.' });
  }
  const result = await pool.query(
    `INSERT INTO tax_codes (company_id, code, name, rate_pct) VALUES ($1, $2, $3, $4) RETURNING id`,
    [req.companyId, code, name, rate_pct]
  );
  res.status(201).json({ taxCode: { id: result.rows[0].id } });
}

async function updateTaxCode(req, res) {
  const fields = {};
  for (const f of ['name', 'rate_pct', 'is_active']) {
    if (f in req.body) fields[f] = req.body[f];
  }
  const cols = Object.keys(fields);
  if (cols.length === 0) return res.json({ taxCode: { id: req.params.id } });
  const setClause = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
  const result = await pool.query(
    `UPDATE tax_codes SET ${setClause} WHERE id = $1 AND company_id = $2 RETURNING id`,
    [req.params.id, req.companyId, ...cols.map((c) => fields[c])]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Tax code not found.' });
  res.json({ taxCode: { id: req.params.id } });
}

// ---------------------------------------------------------------------------
// Sales agents (company-configurable — the "Agent" field on an Exhibitor,
// with a commission rate; reference.controller.js's listAgents is the
// read-only, active-only feed used by that dropdown — this is the Admin
// management side, which also needs to see deactivated agents)
// ---------------------------------------------------------------------------
const AGENT_FIELDS = [
  'name', 'name_alt', 'country_code', 'address', 'postcode', 'city', 'state',
  'salesperson_id', 'reg_no', 'tin_no', 'sst_no', 'website', 'fax', 'comm_rate', 'is_active',
];

async function listAgentsAdmin(req, res) {
  const result = await pool.query(
    `SELECT ag.*, u.full_name AS salesperson_name, cy.name AS country_name
     FROM agents ag
     LEFT JOIN users u ON u.id = ag.salesperson_id
     LEFT JOIN countries cy ON cy.code = ag.country_code
     WHERE ag.company_id = $1 ORDER BY ag.name`,
    [req.companyId]
  );
  res.json({ agents: result.rows });
}

async function createAgent(req, res) {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required.' });
  const fields = {};
  for (const f of AGENT_FIELDS) {
    if (f in req.body) fields[f] = req.body[f] === '' ? null : req.body[f];
  }
  fields.name = name.trim().toUpperCase();
  const cols = Object.keys(fields);
  const result = await pool.query(
    `INSERT INTO agents (company_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
    [req.companyId, ...cols.map((c) => fields[c])]
  );
  res.status(201).json({ agent: { id: result.rows[0].id } });
}

async function updateAgent(req, res) {
  // Everyone can view the agent list (see the /agents GET route), but only
  // Admin or the salesperson this agent is actually assigned to may edit
  // it — matches the Fascia Board pattern (own-assigned-record edit rights
  // for everyone else, full control for Admin).
  if (req.roleCode !== 'ADM') {
    const owner = await pool.query(
      `SELECT salesperson_id FROM agents WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.companyId]
    );
    if (!owner.rows[0]) return res.status(404).json({ error: 'Agent not found.' });
    if (owner.rows[0].salesperson_id !== req.userId) {
      return res.status(403).json({ error: 'Only Admin or this agent\'s assigned salesperson can edit it.' });
    }
  }

  const fields = {};
  for (const f of AGENT_FIELDS) {
    if (f in req.body) fields[f] = req.body[f] === '' ? null : req.body[f];
  }
  if ('name' in fields && fields.name) fields.name = fields.name.trim().toUpperCase();
  const cols = Object.keys(fields);
  if (cols.length === 0) return res.json({ agent: { id: req.params.id } });
  const setClause = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
  const result = await pool.query(
    `UPDATE agents SET ${setClause} WHERE id = $1 AND company_id = $2 RETURNING id`,
    [req.params.id, req.companyId, ...cols.map((c) => fields[c])]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Agent not found.' });
  res.json({ agent: { id: req.params.id } });
}

// ---------------------------------------------------------------------------
// Agent commission rates — an open table per agent (category x exhibitor
// tier -> rate %) rather than a couple of fixed columns, per the user's own
// requirement that a company can add more rows later (a different rate on
// non-booth items, or a further tier beyond repeat/new). category matches
// sales_order_items.category ('BOOTH'/'OTHER'); exhibitor_tier is
// 'REPEAT'/'NEW' today but stored as free text so a future tier doesn't
// need a schema change. See performance.controller.js's getAgentCommission
// for how these are actually applied against real invoiced amounts.
// ---------------------------------------------------------------------------
async function listAgentCommissionRates(req, res) {
  const result = await pool.query(
    `SELECT id, agent_id, category, exhibitor_tier, rate_pct
     FROM agent_commission_rates WHERE company_id = $1 AND agent_id = $2
     ORDER BY category, exhibitor_tier`,
    [req.companyId, req.params.agentId]
  );
  res.json({ commissionRates: result.rows });
}

// Upserts the whole set for one agent in one go — the editor UI is a small
// fixed grid (category x tier), so replacing it wholesale each save is
// simpler and safer than diffing individual row edits.
async function saveAgentCommissionRates(req, res) {
  const rows = Array.isArray(req.body.rates) ? req.body.rates : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const agentCheck = await client.query(
      `SELECT id, salesperson_id FROM agents WHERE id = $1 AND company_id = $2`,
      [req.params.agentId, req.companyId]
    );
    if (!agentCheck.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Agent not found.' });
    }
    // Same ownership rule as updateAgent — Admin, or the salesperson this
    // agent is actually assigned to.
    if (req.roleCode !== 'ADM' && agentCheck.rows[0].salesperson_id !== req.userId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: "Only Admin or this agent's assigned salesperson can edit its commission rates." });
    }
    await client.query(`DELETE FROM agent_commission_rates WHERE agent_id = $1 AND company_id = $2`, [req.params.agentId, req.companyId]);
    for (const r of rows) {
      const category = (r.category || '').toString().trim().toUpperCase();
      const tier = (r.exhibitor_tier || '').toString().trim().toUpperCase();
      const rate = Number(r.rate_pct) || 0;
      if (!category || !tier || rate <= 0) continue; // a blank/zero row just means "no rate set" — nothing to store
      await client.query(
        `INSERT INTO agent_commission_rates (company_id, agent_id, category, exhibitor_tier, rate_pct)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.companyId, req.params.agentId, category, tier, rate]
      );
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

// ---------------------------------------------------------------------------
// Expense codes (company-configurable GL/expense code reference list for
// the Budget module — starts empty, Management sets these up themselves)
// ---------------------------------------------------------------------------
async function listExpenseCodes(req, res) {
  const result = await pool.query(
    `SELECT id, code, description, type, is_active FROM expense_codes
     WHERE company_id = $1 ORDER BY sort_order, code`,
    [req.companyId]
  );
  res.json({ expenseCodes: result.rows });
}

async function createExpenseCode(req, res) {
  const { code, description, type } = req.body;
  if (!code || !description) {
    return res.status(400).json({ error: 'code and description are required.' });
  }
  if (type && !['EXPENSE', 'REVENUE'].includes(type)) {
    return res.status(400).json({ error: 'type must be EXPENSE or REVENUE.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO expense_codes (company_id, code, description, type) VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.companyId, code, description, type || 'EXPENSE']
    );
    res.status(201).json({ expenseCode: { id: result.rows[0].id } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Code ${code} already exists.` });
    throw err;
  }
}

async function updateExpenseCode(req, res) {
  if (req.body.type && !['EXPENSE', 'REVENUE'].includes(req.body.type)) {
    return res.status(400).json({ error: 'type must be EXPENSE or REVENUE.' });
  }
  const fields = {};
  for (const f of ['code', 'description', 'type', 'is_active']) {
    if (f in req.body) fields[f] = req.body[f];
  }
  const cols = Object.keys(fields);
  if (cols.length === 0) return res.json({ expenseCode: { id: req.params.id } });
  const setClause = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
  const result = await pool.query(
    `UPDATE expense_codes SET ${setClause} WHERE id = $1 AND company_id = $2 RETURNING id`,
    [req.params.id, req.companyId, ...cols.map((c) => fields[c])]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Expense code not found.' });
  res.json({ expenseCode: { id: req.params.id } });
}

// ---------------------------------------------------------------------------
// Segments (Main + Sub) — reads live under /api/reference/segments (used by
// exhibitor forms/the public tax-detail-link form); these are the
// Admin-only write endpoints, plus a bulk import from the Excel/CSV
// template (parsed client-side, sent here as plain rows — see
// exportSegmentTemplate/Admin.jsx's Upload button).
// ---------------------------------------------------------------------------
async function createSegmentMain(req, res) {
  const { code, name } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'code and name are required.' });
  try {
    const result = await pool.query(
      `INSERT INTO segment_main (company_id, code, name) VALUES ($1, $2, $3) RETURNING id`,
      [req.companyId, code.trim().toUpperCase(), name.trim().toUpperCase()]
    );
    res.status(201).json({ segmentMain: { id: result.rows[0].id } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Segment code ${code} already exists.` });
    throw err;
  }
}

async function updateSegmentMain(req, res) {
  const { code, name } = req.body;
  const fields = {};
  if (code !== undefined) fields.code = code.trim().toUpperCase();
  if (name !== undefined) fields.name = name.trim().toUpperCase();
  const cols = Object.keys(fields);
  if (cols.length === 0) return res.json({ segmentMain: { id: req.params.id } });
  const setClause = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
  try {
    const result = await pool.query(
      `UPDATE segment_main SET ${setClause} WHERE id = $1 AND company_id = $2 RETURNING id`,
      [req.params.id, req.companyId, ...cols.map((c) => fields[c])]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Segment not found.' });
    res.json({ segmentMain: { id: req.params.id } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Segment code ${code} already exists.` });
    throw err;
  }
}

async function deleteSegmentMain(req, res) {
  try {
    const result = await pool.query(
      `DELETE FROM segment_main WHERE id = $1 AND company_id = $2 RETURNING id`,
      [req.params.id, req.companyId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Segment not found.' });
    res.json({ success: true });
  } catch (err) {
    if (err.code === '23503') return res.status(409).json({ error: 'This segment is in use by one or more exhibitors — remove it from them first, or add its own Sub-Segments below it instead of deleting.' });
    throw err;
  }
}

async function createSegmentSub(req, res) {
  const { segment_main_id, code, name } = req.body;
  if (!segment_main_id || !code || !name) return res.status(400).json({ error: 'segment_main_id, code and name are required.' });
  const main = await pool.query(`SELECT id FROM segment_main WHERE id = $1 AND company_id = $2`, [segment_main_id, req.companyId]);
  if (!main.rows[0]) return res.status(404).json({ error: 'Parent segment not found.' });
  try {
    const result = await pool.query(
      `INSERT INTO segment_sub (company_id, segment_main_id, code, name) VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.companyId, segment_main_id, code.trim().toUpperCase(), name.trim().toUpperCase()]
    );
    res.status(201).json({ segmentSub: { id: result.rows[0].id } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Sub-segment code ${code} already exists under this segment.` });
    throw err;
  }
}

async function updateSegmentSub(req, res) {
  const { code, name } = req.body;
  const fields = {};
  if (code !== undefined) fields.code = code.trim().toUpperCase();
  if (name !== undefined) fields.name = name.trim().toUpperCase();
  const cols = Object.keys(fields);
  if (cols.length === 0) return res.json({ segmentSub: { id: req.params.id } });
  const setClause = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
  try {
    const result = await pool.query(
      `UPDATE segment_sub SET ${setClause} WHERE id = $1 AND company_id = $2 RETURNING id`,
      [req.params.id, req.companyId, ...cols.map((c) => fields[c])]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Sub-segment not found.' });
    res.json({ segmentSub: { id: req.params.id } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Sub-segment code ${code} already exists under this segment.` });
    throw err;
  }
}

async function deleteSegmentSub(req, res) {
  try {
    const result = await pool.query(
      `DELETE FROM segment_sub WHERE id = $1 AND company_id = $2 RETURNING id`,
      [req.params.id, req.companyId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Sub-segment not found.' });
    res.json({ success: true });
  } catch (err) {
    if (err.code === '23503') return res.status(409).json({ error: 'This sub-segment is in use by one or more exhibitors — remove it from them first.' });
    throw err;
  }
}

// Bulk import — rows already parsed client-side from the uploaded Excel/CSV
// (see Admin.jsx), each { main_code, main_name, sub_code, sub_name }.
// Upserts by code so re-uploading a corrected file is safe to repeat.
async function importSegments(req, res) {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (rows.length === 0) return res.status(400).json({ error: 'No rows to import.' });

  let mainsCreated = 0;
  let subsCreated = 0;
  const mainIdByCode = {};

  for (const row of rows) {
    const mainCode = (row.main_code || '').toString().trim().toUpperCase();
    const mainName = (row.main_name || '').toString().trim().toUpperCase();
    if (!mainCode || !mainName) continue;

    if (!mainIdByCode[mainCode]) {
      const result = await pool.query(
        `INSERT INTO segment_main (company_id, code, name) VALUES ($1, $2, $3)
         ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, (xmax = 0) AS inserted`,
        [req.companyId, mainCode, mainName]
      );
      mainIdByCode[mainCode] = result.rows[0].id;
      if (result.rows[0].inserted) mainsCreated += 1;
    }

    const subCode = (row.sub_code || '').toString().trim().toUpperCase();
    const subName = (row.sub_name || '').toString().trim().toUpperCase();
    if (!subCode || !subName) continue;

    const subResult = await pool.query(
      `INSERT INTO segment_sub (company_id, segment_main_id, code, name) VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, segment_main_id, code) DO UPDATE SET name = EXCLUDED.name
       RETURNING (xmax = 0) AS inserted`,
      [req.companyId, mainIdByCode[mainCode], subCode, subName]
    );
    if (subResult.rows[0].inserted) subsCreated += 1;
  }

  res.json({ success: true, mainsCreated, subsCreated, rowsProcessed: rows.length });
}

// ---------------------------------------------------------------------------
// Company settings (currently just the fixed USD:MYR rate)
// ---------------------------------------------------------------------------
const PROFILE_FIELDS = [
  'reg_no', 'tin_no', 'sst_no', 'address', 'phone', 'email',
  'bank_name', 'bank_account_no', 'bank_swift', 'payment_instructions',
  'budget_preparer_user_id', 'budget_approver_user_id', 'lod_pct_of_bas', 'contract_terms',
];

async function getSettings(req, res) {
  const result = await pool.query(
    `SELECT cs.usd_to_myr_rate, cs.reg_no, cs.tin_no, cs.sst_no, cs.address, cs.phone, cs.email,
            cs.bank_name, cs.bank_account_no, cs.bank_swift, cs.payment_instructions,
            cs.lod_pct_of_bas, cs.contract_terms,
            cs.budget_preparer_user_id, cs.budget_approver_user_id,
            up.full_name AS budget_preparer_name, ua.full_name AS budget_approver_name,
            (cs.logo_filename IS NOT NULL) AS has_logo,
            (cs.letterhead_filename IS NOT NULL) AS has_letterhead,
            (cs.footer_filename IS NOT NULL) AS has_footer
     FROM company_settings cs
     LEFT JOIN users up ON up.id = cs.budget_preparer_user_id
     LEFT JOIN users ua ON ua.id = cs.budget_approver_user_id
     WHERE cs.company_id = $1`,
    [req.companyId]
  );
  res.json({ settings: result.rows[0] || { usd_to_myr_rate: 4, lod_pct_of_bas: 15 } });
}

// usd_to_myr_rate is required (it's NOT NULL and always has a value); the
// letterhead/profile fields are optional free text, updated only when sent.
async function updateSettings(req, res) {
  const { usd_to_myr_rate } = req.body;
  if (usd_to_myr_rate !== undefined && Number(usd_to_myr_rate) <= 0) {
    return res.status(400).json({ error: 'usd_to_myr_rate must be a positive number.' });
  }
  if (req.body.lod_pct_of_bas !== undefined && req.body.lod_pct_of_bas !== '' && Number(req.body.lod_pct_of_bas) < 0) {
    return res.status(400).json({ error: 'lod_pct_of_bas cannot be negative.' });
  }

  const profileFields = {};
  for (const f of PROFILE_FIELDS) {
    if (f in req.body) profileFields[f] = req.body[f] === '' ? null : req.body[f];
  }
  // lod_pct_of_bas is NOT NULL (unlike the free-text profile fields above) —
  // an empty field just means "use the default", not "clear it to null".
  if (profileFields.lod_pct_of_bas === null) profileFields.lod_pct_of_bas = 15;

  const existing = await pool.query(`SELECT 1 FROM company_settings WHERE company_id = $1`, [req.companyId]);
  if (existing.rows.length === 0) {
    await pool.query(
      `INSERT INTO company_settings (company_id, usd_to_myr_rate) VALUES ($1, $2)`,
      [req.companyId, usd_to_myr_rate || 4]
    );
  }

  const fields = { ...profileFields };
  if (usd_to_myr_rate !== undefined) fields.usd_to_myr_rate = usd_to_myr_rate;
  const cols = Object.keys(fields);
  if (cols.length > 0) {
    const setClause = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    await pool.query(
      `UPDATE company_settings SET ${setClause} WHERE company_id = $1`,
      [req.companyId, ...cols.map((c) => fields[c])]
    );
  }

  res.json({ success: true });
}

module.exports = {
  listTaxCodes, createTaxCode, updateTaxCode,
  listExpenseCodes, createExpenseCode, updateExpenseCode,
  listAgentsAdmin, createAgent, updateAgent,
  listAgentCommissionRates, saveAgentCommissionRates,
  createSegmentMain, updateSegmentMain, deleteSegmentMain,
  createSegmentSub, updateSegmentSub, deleteSegmentSub, importSegments,
  getSettings, updateSettings,
  uploadBranding, uploadBrandingImage, getBrandingImage, deleteBrandingImage,
};
