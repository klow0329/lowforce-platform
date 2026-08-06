const { pool } = require('../config/db');
const { getAccessibleEventIds } = require('../middleware/eventAccess');

// Countries are a true global reference table (not company-scoped).
async function listCountries(req, res) {
  const result = await pool.query(`SELECT code, name FROM countries ORDER BY name`);
  res.json({ countries: result.rows });
}

async function listAgents(req, res) {
  const result = await pool.query(
    `SELECT id, name FROM agents WHERE company_id = $1 AND is_active = TRUE ORDER BY name`,
    [req.companyId]
  );
  res.json({ agents: result.rows });
}

// Segment Main + Sub, nested, so the form can group sub-segments under their parent.
// Read-only, everyone can see it — which Main events (brands, e.g. "MIFB")
// exist, used to populate Agent's Main-event multi-select. Creating a Main
// itself stays Admin-only (Admin > Events).
async function listMainEvents(req, res) {
  const result = await pool.query(
    `SELECT id, name FROM events WHERE company_id = $1 AND tier = 'MAIN' AND is_active = TRUE ORDER BY name`,
    [req.companyId]
  );
  res.json({ mainEvents: result.rows });
}

// Read-only, everyone can see it — used to populate the Category dropdown
// on Exhibitor's per-event participation and Agent's Main-event assignment.
// Creating/editing the tags themselves stays Admin-only (admin.controller.js).
async function listEventCategories(req, res) {
  const result = await pool.query(
    `SELECT ec.id, ec.main_event_id, ec.code, ec.name
     FROM event_categories ec
     WHERE ec.company_id = $1 AND ec.is_active = TRUE
     ORDER BY ec.sort_order, ec.code`,
    [req.companyId]
  );
  res.json({ eventCategories: result.rows });
}

async function listSegments(req, res) {
  const result = await pool.query(
    `SELECT sm.id AS main_id, sm.code AS main_code, sm.name AS main_name,
            ss.id AS sub_id, ss.code AS sub_code, ss.name AS sub_name
     FROM segment_main sm
     LEFT JOIN segment_sub ss ON ss.segment_main_id = sm.id AND ss.company_id = sm.company_id
     WHERE sm.company_id = $1
     ORDER BY sm.name, ss.name`,
    [req.companyId]
  );

  const mains = new Map();
  for (const row of result.rows) {
    if (!mains.has(row.main_id)) {
      mains.set(row.main_id, { id: row.main_id, code: row.main_code, name: row.main_name, subSegments: [] });
    }
    if (row.sub_id) {
      mains.get(row.main_id).subSegments.push({ id: row.sub_id, code: row.sub_code, name: row.sub_name });
    }
  }

  res.json({ segments: Array.from(mains.values()) });
}

async function listSalespeople(req, res) {
  const result = await pool.query(
    `SELECT id, full_name, email FROM users WHERE company_id = $1 AND is_active = TRUE ORDER BY full_name`,
    [req.companyId]
  );
  res.json({ salespeople: result.rows });
}

// Only the events this user can access — Admin/Management see all, everyone
// else needs a user_event_access grant (managed from the Admin screen).
// The top-bar "which event am I working in" picker. MAIN-tier events are
// deliberately excluded — a Main (e.g. "MIFB") is a brand/grouping, not a
// data-entry scope; users pick an Edition (or Category) to actually work
// in, same as before the Main tier existed. Reuses getAccessibleEventIds
// rather than re-deriving the access cascade here — this used to
// duplicate that logic with only a 1-level parent walk, which would have
// silently stayed stuck at 1 level once Main->Edition->Category made the
// hierarchy 3 deep.
async function listEvents(req, res) {
  const accessibleIds = await getAccessibleEventIds(req.userId, req.companyId);
  if (accessibleIds.length === 0) return res.json({ events: [] });
  const result = await pool.query(
    `SELECT e.id, e.code, e.name, e.event_year, e.parent_event_id, e.tier,
            m.id AS main_event_id, m.code AS main_event_code
     FROM events e
     LEFT JOIN events m ON m.id = e.parent_event_id AND m.tier = 'MAIN'
     WHERE e.company_id = $1 AND e.is_active = TRUE AND e.tier != 'MAIN' AND e.id = ANY($2::uuid[])
     ORDER BY e.event_year DESC, e.name`,
    [req.companyId, accessibleIds]
  );
  res.json({ events: result.rows });
}

async function listStages(req, res) {
  const result = await pool.query(
    `SELECT id, code, name, probability_pct, sort_order, is_won, is_lost
     FROM sales_stages WHERE company_id = $1 ORDER BY sort_order`,
    [req.companyId]
  );
  res.json({ stages: result.rows });
}

// The tenant's own company profile — needed on generated documents
// (contracts, invoices, receipts) as the "For and on behalf of" party and,
// for invoices specifically, the full letterhead/payment-details block.
// event_id (optional query param) resolves the event's logo to the nearest
// MAIN ancestor's own logo (2026-08-05: each Main gets its own uploaded
// logo, not one shared company-wide slot) — walking up parent_event_id
// since an Edition or Category's logo always comes from its Main, never its
// own row. Falls back to the old company-wide company_settings.event_logo
// when the event has no MAIN ancestor (or none uploaded), so a company that
// never introduces the Main tier keeps working exactly as before.
async function getCompany(req, res) {
  const { event_id } = req.query;
  let mainEventId = null;
  let mainHasLogo = false;
  if (event_id) {
    const main = await pool.query(
      `WITH RECURSIVE up AS (
         SELECT id, parent_event_id, tier, logo_filename FROM events WHERE id = $1 AND company_id = $2
         UNION ALL
         SELECT e.id, e.parent_event_id, e.tier, e.logo_filename FROM events e JOIN up ON e.id = up.parent_event_id
       ) SELECT id, logo_filename FROM up WHERE tier = 'MAIN' LIMIT 1`,
      [event_id, req.companyId]
    );
    if (main.rows[0]) {
      mainEventId = main.rows[0].id;
      mainHasLogo = !!main.rows[0].logo_filename;
    }
  }

  const result = await pool.query(
    `SELECT c.id, c.name,
            cs.reg_no, cs.tin_no, cs.sst_no, cs.address, cs.phone, cs.email,
            cs.bank_name, cs.bank_account_no, cs.bank_account_name, cs.bank_swift, cs.payment_instructions,
            cs.contract_terms, cs.event_name, cs.payment_terms_wording, cs.declaration_wording,
            (cs.logo_filename IS NOT NULL) AS has_logo,
            (cs.letterhead_filename IS NOT NULL) AS has_letterhead,
            (cs.footer_filename IS NOT NULL) AS has_footer,
            (cs.event_logo_filename IS NOT NULL) AS has_event_logo,
            (cs.contract_terms_pdf_filename IS NOT NULL) AS has_contract_terms_pdf
     FROM companies c
     LEFT JOIN company_settings cs ON cs.company_id = c.id
     WHERE c.id = $1`,
    [req.companyId]
  );
  const company = result.rows[0];
  if (mainEventId) {
    company.main_event_id = mainEventId;
    company.has_event_logo = mainHasLogo;
  }
  res.json({ company });
}

// Credit Note reason categories — company-configurable (standing rule #2).
async function listCnReasonCodes(req, res) {
  const result = await pool.query(
    `SELECT id, code, label FROM cn_reason_codes WHERE company_id = $1 AND is_active = TRUE ORDER BY sort_order`,
    [req.companyId]
  );
  res.json({ reasonCodes: result.rows });
}

module.exports = { listCountries, listAgents, listSegments, listSalespeople, listEvents, listEventCategories, listMainEvents, listStages, getCompany, listCnReasonCodes };
