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
// Expense codes (company-configurable GL/expense code reference list for
// the Budget module — starts empty, Management sets these up themselves)
// ---------------------------------------------------------------------------
async function listExpenseCodes(req, res) {
  const result = await pool.query(
    `SELECT id, code, description, is_active FROM expense_codes
     WHERE company_id = $1 ORDER BY sort_order, code`,
    [req.companyId]
  );
  res.json({ expenseCodes: result.rows });
}

async function createExpenseCode(req, res) {
  const { code, description } = req.body;
  if (!code || !description) {
    return res.status(400).json({ error: 'code and description are required.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO expense_codes (company_id, code, description) VALUES ($1, $2, $3) RETURNING id`,
      [req.companyId, code, description]
    );
    res.status(201).json({ expenseCode: { id: result.rows[0].id } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Code ${code} already exists.` });
    throw err;
  }
}

async function updateExpenseCode(req, res) {
  const fields = {};
  for (const f of ['code', 'description', 'is_active']) {
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
// Company settings (currently just the fixed USD:MYR rate)
// ---------------------------------------------------------------------------
const PROFILE_FIELDS = [
  'reg_no', 'tin_no', 'sst_no', 'address', 'phone', 'email',
  'bank_name', 'bank_account_no', 'bank_swift', 'payment_instructions',
  'budget_preparer_user_id', 'budget_approver_user_id',
];

async function getSettings(req, res) {
  const result = await pool.query(
    `SELECT cs.usd_to_myr_rate, cs.reg_no, cs.tin_no, cs.sst_no, cs.address, cs.phone, cs.email,
            cs.bank_name, cs.bank_account_no, cs.bank_swift, cs.payment_instructions,
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
  res.json({ settings: result.rows[0] || { usd_to_myr_rate: 4 } });
}

// usd_to_myr_rate is required (it's NOT NULL and always has a value); the
// letterhead/profile fields are optional free text, updated only when sent.
async function updateSettings(req, res) {
  const { usd_to_myr_rate } = req.body;
  if (usd_to_myr_rate !== undefined && Number(usd_to_myr_rate) <= 0) {
    return res.status(400).json({ error: 'usd_to_myr_rate must be a positive number.' });
  }

  const profileFields = {};
  for (const f of PROFILE_FIELDS) {
    if (f in req.body) profileFields[f] = req.body[f] === '' ? null : req.body[f];
  }

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
  getSettings, updateSettings,
  uploadBranding, uploadBrandingImage, getBrandingImage, deleteBrandingImage,
};
