const { pool } = require('../config/db');

// Countries are a true global reference table (not company-scoped).
async function listCountries(req, res) {
  const result = await pool.query(`SELECT code, name FROM countries ORDER BY name`);
  res.json({ countries: result.rows });
}

async function listAgents(req, res) {
  const result = await pool.query(
    `SELECT id, name, comm_rate FROM agents WHERE company_id = $1 AND is_active = TRUE ORDER BY name`,
    [req.companyId]
  );
  res.json({ agents: result.rows });
}

// Segment Main + Sub, nested, so the form can group sub-segments under their parent.
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
async function listEvents(req, res) {
  const result = await pool.query(
    `SELECT e.id, e.code, e.name, e.event_year, e.parent_event_id
     FROM events e
     WHERE e.company_id = $1 AND e.is_active = TRUE
       AND (
         EXISTS (
           SELECT 1 FROM users u LEFT JOIN roles r ON r.id = u.role_id
           WHERE u.id = $2 AND r.code IN ('ADM', 'MGT')
         )
         OR EXISTS (
           SELECT 1 FROM user_event_access uea
           WHERE uea.user_id = $2 AND uea.is_active = TRUE
             AND (uea.event_id = e.id OR uea.event_id = e.parent_event_id)
         )
       )
     ORDER BY e.event_year DESC, e.name`,
    [req.companyId, req.userId]
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

// The tenant's own company name — needed on generated documents (contracts,
// invoices, receipts) as the "For and on behalf of" party.
async function getCompany(req, res) {
  const result = await pool.query(`SELECT id, name FROM companies WHERE id = $1`, [req.companyId]);
  res.json({ company: result.rows[0] });
}

module.exports = { listCountries, listAgents, listSegments, listSalespeople, listEvents, listStages, getCompany };
