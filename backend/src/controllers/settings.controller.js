const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { pool } = require('../config/db');
const { cleanText, cleanLower, cleanKeepCase, cleanDigits } = require('../utils/importNormalize');
const { setSharing } = require('../utils/groupSharing');

// ---------------------------------------------------------------------------
// Company branding — logo, letterhead header strip, footer strip. Rendered
// on every official printed document (Contract/Proforma/Invoice/Receipt/
// Statement) so a second company selling this platform can carry their own
// identity on documents sent to their exhibitors, not ExpoCO's. Same
// disk-storage pattern as Floor Plan uploads: random on-disk filename,
// original name never trusted as a path, gitignored uploads dir.
const BRANDING_DIR = path.join(__dirname, '..', '..', 'uploads', 'branding');
fs.mkdirSync(BRANDING_DIR, { recursive: true });
const BRANDING_TYPES = ['logo', 'letterhead', 'footer', 'event_logo', 'contract_terms_pdf'];
const BRANDING_COLUMN = {
  logo: 'logo_filename', letterhead: 'letterhead_filename', footer: 'footer_filename', event_logo: 'event_logo_filename',
  // Not an image — the company's own formatted Terms & Conditions PDF,
  // auto-appended as trailing pages onto the generated Contract PDF (see
  // frontend/src/utils/pdf.js's appendPdf) instead of re-typing it into the
  // plain-text contract_terms field every time.
  contract_terms_pdf: 'contract_terms_pdf_filename',
};
const PDF_BRANDING_TYPES = ['contract_terms_pdf'];

const brandingStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, BRANDING_DIR),
  filename: (req, file, cb) => cb(null, `${crypto.randomBytes(16).toString('hex')}${path.extname(file.originalname)}`),
});
const uploadBranding = multer({
  // 3MB, matching every document attachment type in the app. This used to
  // be 10MB here while the Admin screen told users 5MB — a genuine
  // mismatch, so the two are now aligned on one number.
  storage: brandingStorage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isPdfType = PDF_BRANDING_TYPES.includes(req.params.type);
    if (isPdfType) {
      if (file.mimetype !== 'application/pdf') return cb(new Error('Only a PDF file is accepted here.'));
    } else if (!/^image\//.test(file.mimetype)) {
      return cb(new Error('Only image files (PNG/JPG) are accepted.'));
    }
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

// ---------------------------------------------------------------------------
// Per-MAIN-event logo (2026-08-05) — each MAIN-tier event (see migration
// 083) gets its own logo, distinct from the company's own corporate logo
// AND from any other Main the company runs. Same disk-storage/BRANDING_DIR
// convention as the company-wide branding images above, just keyed by
// events.logo_filename (row-scoped) instead of company_settings (one global
// slot) — that's the whole point: a company running MIFB and, say,
// AgriFood side by side needs two different event logos, not one.
// ---------------------------------------------------------------------------
const uploadMainEventLogo = multer({
  storage: brandingStorage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('Only image files (PNG/JPG) are accepted.'));
    cb(null, true);
  },
});

async function uploadEventLogo(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });
  const existing = await pool.query(
    `SELECT logo_filename FROM events WHERE id = $1 AND company_id = $2 AND tier = 'MAIN'`,
    [req.params.id, req.companyId]
  );
  if (!existing.rows[0]) {
    fs.unlink(path.join(BRANDING_DIR, req.file.filename), () => {});
    return res.status(404).json({ error: 'Main event not found.' });
  }
  await pool.query(`UPDATE events SET logo_filename = $1 WHERE id = $2`, [req.file.filename, req.params.id]);
  if (existing.rows[0].logo_filename) {
    fs.unlink(path.join(BRANDING_DIR, existing.rows[0].logo_filename), () => {});
  }
  res.json({ success: true });
}

async function deleteEventLogo(req, res) {
  const existing = await pool.query(
    `SELECT logo_filename FROM events WHERE id = $1 AND company_id = $2 AND tier = 'MAIN'`,
    [req.params.id, req.companyId]
  );
  if (!existing.rows[0]) return res.status(404).json({ error: 'Main event not found.' });
  await pool.query(`UPDATE events SET logo_filename = NULL WHERE id = $1`, [req.params.id]);
  if (existing.rows[0].logo_filename) {
    fs.unlink(path.join(BRANDING_DIR, existing.rows[0].logo_filename), () => {});
  }
  res.json({ success: true });
}

// Public read within the tenant (session-authenticated, not URL-guessable
// data) — same convention as getBrandingImage below.
async function getEventLogo(req, res) {
  const result = await pool.query(
    `SELECT logo_filename FROM events WHERE id = $1 AND company_id = $2 AND tier = 'MAIN'`,
    [req.params.id, req.companyId]
  );
  const filename = result.rows[0] && result.rows[0].logo_filename;
  if (!filename) return res.status(404).json({ error: 'No image uploaded.' });
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(BRANDING_DIR, filename));
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
  // This URL is the same for every logo a company ever uploads (only the
  // file on disk changes) — without this, a browser can keep serving a
  // stale cached image after a re-upload or removal.
  res.set('Cache-Control', 'no-store');
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
// comm_rate is NOT editable here — the old single flat rate has been
// superseded entirely by the open per-item-code/tier rate table below
// (agent_commission_rates) plus threshold bonus tiers
// (agent_commission_bonus_tiers), so a company isn't stuck with one number
// for every kind of revenue.
const AGENT_FIELDS = [
  'name', 'name_alt', 'country_code', 'address', 'postcode', 'city', 'state',
  'salesperson_id', 'reg_no', 'tin_no', 'sst_no', 'website', 'fax', 'is_active',
  'contact_name', 'contact_job_title', 'contact_phone', 'contact_email',
];

async function listAgentsAdmin(req, res) {
  const result = await pool.query(
    `SELECT ag.*, u.full_name AS salesperson_name, cy.name AS country_name,
            (SELECT COALESCE(STRING_AGG(m.code, ', ' ORDER BY m.code), '')
               FROM agent_main_events ame JOIN events m ON m.id = ame.main_event_id
              WHERE ame.agent_id = ag.id) AS main_event_names,
            (SELECT COALESCE(ARRAY_AGG(ame.main_event_id), ARRAY[]::uuid[])
               FROM agent_main_events ame WHERE ame.agent_id = ag.id) AS main_event_ids
     FROM agents ag
     LEFT JOIN users u ON u.id = ag.salesperson_id
     LEFT JOIN countries cy ON cy.code = ag.country_code
     WHERE ag.company_id = $1 ORDER BY ag.name`,
    [req.companyId]
  );
  res.json({ agents: result.rows });
}

// Standing fact about the agent (2026-08-05), not per-year — an agent can
// be linked to MULTIPLE Main events ("imagine like SIAL international,
// which [runs] across the region with different events" — user's own
// example). Replace-all on save, same pattern as saveAgentCommissionRates
// below — simpler than diffing adds/removes for a small set.
async function setAgentMainEvents(req, res) {
  const { main_event_ids } = req.body;
  if (!Array.isArray(main_event_ids)) return res.status(400).json({ error: 'main_event_ids must be an array.' });

  const agent = await pool.query(`SELECT id FROM agents WHERE id = $1 AND company_id = $2`, [req.params.id, req.companyId]);
  if (!agent.rows[0]) return res.status(404).json({ error: 'Agent not found.' });

  if (main_event_ids.length > 0) {
    const valid = await pool.query(
      `SELECT id FROM events WHERE id = ANY($1::uuid[]) AND company_id = $2 AND tier = 'MAIN'`,
      [main_event_ids, req.companyId]
    );
    if (valid.rows.length !== main_event_ids.length) {
      return res.status(400).json({ error: 'One or more selected events are not Main-tier events.' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM agent_main_events WHERE agent_id = $1`, [req.params.id]);
    for (const mainEventId of main_event_ids) {
      await client.query(`INSERT INTO agent_main_events (agent_id, main_event_id) VALUES ($1, $2)`, [req.params.id, mainEventId]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  res.json({ success: true });
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

// Bulk add/update — matched by UPPER(TRIM(name)) since agents has no unique
// code column (unlike Expense Codes/Segments). Never deletes; a name that
// already exists gets its other fields updated, a new name gets created.
// See Admin > Data Import > Agents.
async function importAgents(req, res) {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (rows.length === 0) return res.status(400).json({ error: 'No rows to import.' });

  let created = 0;
  let updated = 0;
  const skipped = [];

  for (const row of rows) {
    const name = cleanText(row.name);
    if (!name) continue;

    let salespersonId = null;
    const salespersonEmail = cleanLower(row.salesperson_email);
    if (salespersonEmail) {
      const u = await pool.query(
        `SELECT id FROM users WHERE company_id = $1 AND LOWER(email) = LOWER($2)`,
        [req.companyId, salespersonEmail]
      );
      if (u.rows[0]) salespersonId = u.rows[0].id;
      else skipped.push(`${name}: salesperson email "${salespersonEmail}" not found (agent still saved, unassigned)`);
    }

    // Trimmed + uppercased like the exhibitor import, except website (kept
    // as-typed), postcode/contact_phone (digits only), and contact_email
    // (lowercased) — see importNormalize.js.
    const fields = {
      name_alt: cleanText(row.name_alt) || null, country_code: cleanText(row.country_code) || null,
      address: cleanText(row.address) || null, postcode: cleanDigits(row.postcode) || null,
      city: cleanText(row.city) || null, state: cleanText(row.state) || null,
      reg_no: cleanText(row.reg_no) || null, tin_no: cleanText(row.tin_no) || null, sst_no: cleanText(row.sst_no) || null,
      website: cleanKeepCase(row.website) || null, fax: cleanText(row.fax) || null,
      contact_name: cleanText(row.contact_name) || null, contact_job_title: cleanText(row.contact_job_title) || null,
      contact_phone: cleanDigits(row.contact_phone) || null, contact_email: cleanLower(row.contact_email) || null,
    };
    if (salespersonId) fields.salesperson_id = salespersonId;

    const existing = await pool.query(
      `SELECT id FROM agents WHERE company_id = $1 AND UPPER(TRIM(name)) = $2`,
      [req.companyId, name]
    );
    const cols = Object.keys(fields);
    let agentId;
    if (existing.rows[0]) {
      agentId = existing.rows[0].id;
      if (cols.length > 0) {
        const setClause = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
        await pool.query(
          `UPDATE agents SET ${setClause} WHERE id = $1 AND company_id = $2`,
          [agentId, req.companyId, ...cols.map((c) => fields[c])]
        );
      }
      updated += 1;
    } else {
      const inserted = await pool.query(
        `INSERT INTO agents (company_id, name, ${cols.join(', ')}) VALUES ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING id`,
        [req.companyId, name, ...cols.map((c) => fields[c])]
      );
      agentId = inserted.rows[0].id;
      created += 1;
    }

    // Which Main event(s) this agent represents, comma-separated Main event
    // CODES (e.g. "MIFB, AGRIFOOD") — short/unambiguous for a spreadsheet
    // cell, matching how event names are shown as codes everywhere else in
    // the app. Additive: a code not listed is left alone, so a partial
    // import can't silently unlink an existing one.
    const mainEventCodes = cleanText(row.main_events).split(',').map((s) => s.trim()).filter(Boolean);
    for (const mainCode of mainEventCodes) {
      const m = await pool.query(
        `SELECT id FROM events WHERE company_id = $1 AND tier = 'MAIN' AND UPPER(TRIM(code)) = UPPER($2)`,
        [req.companyId, mainCode]
      );
      if (!m.rows[0]) {
        skipped.push(`${name}: Main event "${mainCode}" not found (agent still saved, that Main not linked)`);
        continue;
      }
      await pool.query(
        `INSERT INTO agent_main_events (agent_id, main_event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [agentId, m.rows[0].id]
      );
    }
  }

  res.json({ success: true, created, updated, rowsProcessed: rows.length, skipped });
}

// ---------------------------------------------------------------------------
// Agent commission rates — an open table per agent (item code x exhibitor
// tier -> rate %) rather than a fixed grid, per the user's own requirement
// that any Price List item (not just a broad Booth/Non-Booth split) can
// carry its own rate, plus a company-wide 'ALL' catch-all for anything not
// explicitly set. item_code is one of the standing template codes
// (BAS/SSS/ESS/WOP/CUB/COR/LOD/MEP/SPO/BAD/OTH, see BillingTemplate.jsx's
// FIXED_LABELS) or 'ALL'; exhibitor_tier is 'REPEAT'/'NEW' today but stored
// as free text so a future tier doesn't need a schema change. See
// performance.controller.js's getAgentCommission for how these are actually
// applied against real invoiced amounts, and agent_commission_bonus_tiers
// below for revenue/sqm threshold bonuses on top.
// ---------------------------------------------------------------------------
const COMMISSION_ITEM_CODES = ['ALL', 'BAS', 'SSS', 'ESS', 'WOP', 'CUB', 'COR', 'LOD', 'MEP', 'SPO', 'BAD', 'OTH'];

async function listAgentCommissionRates(req, res) {
  const result = await pool.query(
    `SELECT id, agent_id, item_code, exhibitor_tier, rate_pct
     FROM agent_commission_rates WHERE company_id = $1 AND agent_id = $2
     ORDER BY item_code, exhibitor_tier`,
    [req.companyId, req.params.agentId]
  );
  res.json({ commissionRates: result.rows });
}

// Upserts the whole set for one agent in one go — the editor UI is a small
// free-form list, so replacing it wholesale each save is simpler and safer
// than diffing individual row edits.
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
      const itemCode = (r.item_code || '').toString().trim().toUpperCase();
      const tier = (r.exhibitor_tier || '').toString().trim().toUpperCase();
      const rate = Number(r.rate_pct) || 0;
      if (!itemCode || !tier || rate <= 0) continue; // a blank/zero row just means "no rate set" — nothing to store
      if (!COMMISSION_ITEM_CODES.includes(itemCode)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Unknown item code "${itemCode}".` });
      }
      await client.query(
        `INSERT INTO agent_commission_rates (company_id, agent_id, item_code, exhibitor_tier, rate_pct)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.companyId, req.params.agentId, itemCode, tier, rate]
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

// Threshold bonus tiers — an ADDITIONAL bonus % on top of the base rate
// table above once an agent's total commission-eligible business for the
// event crosses a revenue or sqm threshold, per the user's own request.
// Compared/paid in MYR (see getAgentCommission) since a threshold has to be
// a single comparable number even when the agent's underlying invoices are
// in mixed currencies — unlike the base commission, which stays in each
// invoice's own currency.
async function listAgentCommissionBonusTiers(req, res) {
  const result = await pool.query(
    `SELECT id, agent_id, threshold_type, threshold_value, bonus_pct
     FROM agent_commission_bonus_tiers WHERE company_id = $1 AND agent_id = $2
     ORDER BY threshold_type, threshold_value`,
    [req.companyId, req.params.agentId]
  );
  res.json({ bonusTiers: result.rows });
}

async function saveAgentCommissionBonusTiers(req, res) {
  const rows = Array.isArray(req.body.bonusTiers) ? req.body.bonusTiers : [];
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
    if (req.roleCode !== 'ADM' && agentCheck.rows[0].salesperson_id !== req.userId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: "Only Admin or this agent's assigned salesperson can edit its bonus tiers." });
    }
    await client.query(`DELETE FROM agent_commission_bonus_tiers WHERE agent_id = $1 AND company_id = $2`, [req.params.agentId, req.companyId]);
    for (const r of rows) {
      const thresholdType = (r.threshold_type || '').toString().trim().toUpperCase();
      const thresholdValue = Number(r.threshold_value) || 0;
      const bonusPct = Number(r.bonus_pct) || 0;
      if (!['REVENUE_MYR', 'SQM'].includes(thresholdType) || thresholdValue <= 0 || bonusPct <= 0) continue;
      await client.query(
        `INSERT INTO agent_commission_bonus_tiers (company_id, agent_id, threshold_type, threshold_value, bonus_pct)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.companyId, req.params.agentId, thresholdType, thresholdValue, bonusPct]
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

// Bulk add/update by code (unique per company) — see Admin > Data Import > Expense Codes.
async function importExpenseCodes(req, res) {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (rows.length === 0) return res.status(400).json({ error: 'No rows to import.' });

  let created = 0;
  let updated = 0;
  const errors = [];

  for (const row of rows) {
    const code = cleanText(row.code);
    const description = cleanText(row.description);
    const type = cleanText(row.type) || 'EXPENSE';
    if (!code || !description) continue;
    if (!['EXPENSE', 'REVENUE'].includes(type)) {
      errors.push(`${code}: type must be EXPENSE or REVENUE, got "${type}"`);
      continue;
    }
    const result = await pool.query(
      `INSERT INTO expense_codes (company_id, code, description, type) VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, code) DO UPDATE SET description = EXCLUDED.description, type = EXCLUDED.type
       RETURNING (xmax = 0) AS inserted`,
      [req.companyId, code, description, type]
    );
    if (result.rows[0].inserted) created += 1; else updated += 1;
  }

  res.json({ success: true, created, updated, rowsProcessed: rows.length, errors });
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
  'bank_name', 'bank_account_no', 'bank_account_name', 'bank_swift', 'payment_instructions',
  'budget_preparer_user_id', 'budget_approver_user_id', 'contract_terms', 'event_name',
  'stamp_duty_enabled', 'stamp_duty_rate_pct', 'stamp_duty_round_to', 'stamp_duty_minimum',
  'payment_terms_wording', 'declaration_wording',
];

async function getSettings(req, res) {
  const result = await pool.query(
    `SELECT cs.usd_to_myr_rate, cs.reg_no, cs.tin_no, cs.sst_no, cs.address, cs.phone, cs.email,
            cs.bank_name, cs.bank_account_no, cs.bank_account_name, cs.bank_swift, cs.payment_instructions,
            cs.contract_terms, cs.event_name, cs.payment_terms_wording, cs.declaration_wording,
            cs.budget_preparer_user_id, cs.budget_approver_user_id,
            up.full_name AS budget_preparer_name, ua.full_name AS budget_approver_name,
            cs.stamp_duty_enabled, cs.stamp_duty_rate_pct, cs.stamp_duty_round_to, cs.stamp_duty_minimum,
            (cs.logo_filename IS NOT NULL) AS has_logo,
            (cs.letterhead_filename IS NOT NULL) AS has_letterhead,
            (cs.footer_filename IS NOT NULL) AS has_footer,
            (cs.event_logo_filename IS NOT NULL) AS has_event_logo,
            (cs.contract_terms_pdf_filename IS NOT NULL) AS has_contract_terms_pdf
     FROM company_settings cs
     LEFT JOIN users up ON up.id = cs.budget_preparer_user_id
     LEFT JOIN users ua ON ua.id = cs.budget_approver_user_id
     WHERE cs.company_id = $1`,
    [req.companyId]
  );
  // Group resource sharing (migration 079) lives in its own table keyed by
  // resource_type — not a company_settings column — so the planned Vendor
  // list needs no schema change. Surfaced here so Company Profile can show
  // one toggle per shared resource. Also reports whether this company even
  // belongs to a group, since the toggle is meaningless if it doesn't.
  const groupResult = await pool.query(
    `SELECT c.group_id, g.name AS group_name,
            (SELECT COUNT(*) FROM companies peer WHERE peer.group_id = c.group_id AND peer.id <> c.id) AS peer_count
     FROM companies c LEFT JOIN groups g ON g.id = c.group_id
     WHERE c.id = $1`,
    [req.companyId]
  );
  const sharingResult = await pool.query(
    `SELECT resource_type, is_shared FROM company_group_sharing WHERE company_id = $1`,
    [req.companyId]
  );

  res.json({
    settings: result.rows[0] || { usd_to_myr_rate: 4 },
    group: groupResult.rows[0] || null,
    sharing: Object.fromEntries(sharingResult.rows.map((r) => [r.resource_type, r.is_shared])),
  });
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

// Turn group sharing on/off for one resource type. Admin-only (see the
// route) — this decides whether other legal entities in the group can see
// this company's records at all, so it is not an ordinary settings edit.
const SHAREABLE_RESOURCES = ['EXHIBITORS'];
async function updateGroupSharing(req, res) {
  const { resource_type, is_shared } = req.body;
  if (!SHAREABLE_RESOURCES.includes(resource_type)) {
    return res.status(400).json({ error: `Unknown resource type "${resource_type}".` });
  }
  // Pointless (and misleading) to enable sharing for a standalone company —
  // there is no group to share with.
  const grp = await pool.query(`SELECT group_id FROM companies WHERE id = $1`, [req.companyId]);
  if (is_shared && !grp.rows[0]?.group_id) {
    return res.status(400).json({ error: 'This company does not belong to a group, so there is nothing to share with.' });
  }
  await setSharing(req.companyId, resource_type, is_shared, req.userId);
  res.json({ success: true });
}

module.exports = {
  listTaxCodes, createTaxCode, updateTaxCode,
  listExpenseCodes, createExpenseCode, updateExpenseCode, importExpenseCodes,
  listAgentsAdmin, createAgent, updateAgent, importAgents, setAgentMainEvents,
  listAgentCommissionRates, saveAgentCommissionRates,
  listAgentCommissionBonusTiers, saveAgentCommissionBonusTiers,
  createSegmentMain, updateSegmentMain, deleteSegmentMain,
  createSegmentSub, updateSegmentSub, deleteSegmentSub, importSegments,
  getSettings, updateSettings, updateGroupSharing,
  uploadBranding, uploadBrandingImage, getBrandingImage, deleteBrandingImage,
  uploadMainEventLogo, uploadEventLogo, getEventLogo, deleteEventLogo,
};
