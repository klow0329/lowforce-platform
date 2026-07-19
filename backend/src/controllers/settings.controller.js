const { pool } = require('../config/db');

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
// Company settings (currently just the fixed USD:MYR rate)
// ---------------------------------------------------------------------------
async function getSettings(req, res) {
  const result = await pool.query(
    `SELECT usd_to_myr_rate FROM company_settings WHERE company_id = $1`,
    [req.companyId]
  );
  res.json({ settings: result.rows[0] || { usd_to_myr_rate: 4 } });
}

async function updateSettings(req, res) {
  const { usd_to_myr_rate } = req.body;
  if (!usd_to_myr_rate || Number(usd_to_myr_rate) <= 0) {
    return res.status(400).json({ error: 'usd_to_myr_rate must be a positive number.' });
  }
  await pool.query(
    `INSERT INTO company_settings (company_id, usd_to_myr_rate) VALUES ($1, $2)
     ON CONFLICT (company_id) DO UPDATE SET usd_to_myr_rate = EXCLUDED.usd_to_myr_rate`,
    [req.companyId, usd_to_myr_rate]
  );
  res.json({ success: true });
}

module.exports = { listTaxCodes, createTaxCode, updateTaxCode, getSettings, updateSettings };
