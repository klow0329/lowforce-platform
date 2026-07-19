const { pool } = require('../config/db');
const { visibilityClause } = require('../utils/visibility');

// Pipeline list — filterable by event, stage, salesperson ("My
// Opportunities"), exhibitor (for the "linked opportunities" list on the
// Exhibitor detail screen, which spans all events), and a free-text search
// on the exhibitor's company name. At least one of event_id/exhibitor_id
// is required so this can't accidentally return the whole company's pipeline.
async function listOpportunities(req, res) {
  const { event_id, stage_id, salesperson_id, exhibitor_id, search } = req.query;

  if (!event_id && !exhibitor_id) {
    return res.status(400).json({ error: 'event_id or exhibitor_id is required.' });
  }

  const vis = visibilityClause(req, 'o.salesperson_id', 7);

  const result = await pool.query(
    `SELECT o.id, o.exhibitor_id, ex.company_name AS exhibitor_name,
            o.event_id, ev.name AS event_name,
            o.salesperson_id, u.full_name AS salesperson_name,
            o.stage_id, st.code AS stage_code, st.name AS stage_name,
            st.probability_pct, st.is_won, st.is_lost,
            o.booth_sqm, o.booth_type, o.booking_type, o.currency, o.estimated_value_myr, o.next_follow_up_date
     FROM opportunities o
     JOIN exhibitors ex ON ex.id = o.exhibitor_id
     JOIN events ev ON ev.id = o.event_id
     JOIN sales_stages st ON st.id = o.stage_id
     LEFT JOIN users u ON u.id = o.salesperson_id
     WHERE o.company_id = $1
       AND ($2::uuid IS NULL OR o.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2))
       AND o.is_active = TRUE
       AND ($3::uuid IS NULL OR o.stage_id = $3)
       AND ($4::uuid IS NULL OR o.salesperson_id = $4)
       AND ($5 = '' OR ex.company_name ILIKE '%' || $5 || '%')
       AND ($6::uuid IS NULL OR o.exhibitor_id = $6)
       AND ${vis.sql}
     ORDER BY o.next_follow_up_date NULLS LAST, ex.company_name`,
    [req.companyId, event_id || null, stage_id || null, salesperson_id || null, search || '', exhibitor_id || null,
     ...(vis.param !== undefined ? [vis.param] : [])]
  );

  res.json({ opportunities: result.rows });
}

// Rollup by stage — value / sqm / company count / conversion rate, matching
// the current Excel OPPORTUNITY tab. Conversion rate = won / (won + lost),
// mirroring how the Excel workbook defines it (open opportunities aren't
// counted as "not converted" since they haven't resolved either way yet).
async function getOpportunitySummary(req, res) {
  const { event_id } = req.query;
  if (!event_id) {
    return res.status(400).json({ error: 'event_id is required.' });
  }

  const vis = visibilityClause(req, 'o.salesperson_id', 3);

  const result = await pool.query(
    `SELECT st.id AS stage_id, st.code, st.name, st.sort_order, st.is_won, st.is_lost,
            COUNT(o.id) AS opp_count,
            COALESCE(SUM(o.estimated_value_myr), 0) AS total_value_myr,
            COALESCE(SUM(o.booth_sqm), 0) AS total_sqm,
            COUNT(DISTINCT o.exhibitor_id) AS company_count
     FROM sales_stages st
     LEFT JOIN opportunities o
       ON o.stage_id = st.id AND o.company_id = st.company_id
      AND o.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
      AND o.is_active = TRUE
      AND ${vis.sql}
     WHERE st.company_id = $1
     GROUP BY st.id, st.code, st.name, st.sort_order, st.is_won, st.is_lost
     ORDER BY st.sort_order`,
    [req.companyId, event_id, ...(vis.param !== undefined ? [vis.param] : [])]
  );

  const wonCount = result.rows.filter((r) => r.is_won).reduce((sum, r) => sum + Number(r.opp_count), 0);
  const lostCount = result.rows.filter((r) => r.is_lost).reduce((sum, r) => sum + Number(r.opp_count), 0);
  const resolvedCount = wonCount + lostCount;
  const conversionRatePct = resolvedCount > 0 ? (wonCount / resolvedCount) * 100 : 0;

  const totals = result.rows.reduce(
    (acc, r) => ({
      opp_count: acc.opp_count + Number(r.opp_count),
      total_value_myr: acc.total_value_myr + Number(r.total_value_myr),
      total_sqm: acc.total_sqm + Number(r.total_sqm),
    }),
    { opp_count: 0, total_value_myr: 0, total_sqm: 0 }
  );

  res.json({ byStage: result.rows, totals: { ...totals, conversionRatePct } });
}

async function getOpportunity(req, res) {
  const vis = visibilityClause(req, 'o.salesperson_id', 3);
  const result = await pool.query(
    `SELECT o.*, ex.company_name AS exhibitor_name
     FROM opportunities o
     JOIN exhibitors ex ON ex.id = o.exhibitor_id
     WHERE o.id = $1 AND o.company_id = $2 AND ${vis.sql}`,
    [req.params.id, req.companyId, ...(vis.param !== undefined ? [vis.param] : [])]
  );
  const opportunity = result.rows[0];
  if (!opportunity) {
    return res.status(404).json({ error: 'Opportunity not found.' });
  }
  res.json({ opportunity });
}

const OPPORTUNITY_FIELDS = [
  'exhibitor_id', 'event_id', 'salesperson_id', 'stage_id', 'booking_type', 'currency',
  'booth_sqm', 'booth_type', 'hall', 'booth_no', 'dimension',
  'estimated_value_myr', 'next_follow_up_date', 'remarks',
];

function pickOpportunityFields(body) {
  const out = {};
  for (const field of OPPORTUNITY_FIELDS) {
    if (field in body) out[field] = body[field] === '' ? null : body[field];
  }
  return out;
}

async function createOpportunity(req, res) {
  const fields = pickOpportunityFields(req.body);

  if (!fields.exhibitor_id || !fields.event_id || !fields.stage_id) {
    return res.status(400).json({ error: 'exhibitor_id, event_id and stage_id are required.' });
  }

  const columns = Object.keys(fields);
  const placeholders = columns.map((_, i) => `$${i + 2}`);

  const result = await pool.query(
    `INSERT INTO opportunities (company_id, ${columns.join(', ')})
     VALUES ($1, ${placeholders.join(', ')})
     RETURNING id`,
    [req.companyId, ...columns.map((c) => fields[c])]
  );

  res.status(201).json({ opportunity: { id: result.rows[0].id } });
}

async function updateOpportunity(req, res) {
  const fields = pickOpportunityFields(req.body);
  const columns = Object.keys(fields);

  if (columns.length === 0) {
    return res.json({ opportunity: { id: req.params.id } });
  }

  const setClause = columns.map((c, i) => `${c} = $${i + 3}`).join(', ');
  const result = await pool.query(
    `UPDATE opportunities SET ${setClause}
     WHERE id = $1 AND company_id = $2
     RETURNING id`,
    [req.params.id, req.companyId, ...columns.map((c) => fields[c])]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: 'Opportunity not found.' });
  }

  res.json({ opportunity: { id: req.params.id } });
}

module.exports = {
  listOpportunities,
  getOpportunitySummary,
  getOpportunity,
  createOpportunity,
  updateOpportunity,
};
