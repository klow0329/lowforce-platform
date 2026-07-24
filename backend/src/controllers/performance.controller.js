// Performance Reports — replaces the Excel "MIFB26 SALES REPORT" tab.
// Achieved/contracted figures count APPROVED, active contracts only (drafts
// and pending-approval contracts are pipeline, not achievement); invoiced
// figures count CONFIRMED invoices only. All figures are event-scoped
// (main event + sub-events, same pattern as the Dashboard).
const { pool } = require('../config/db');
const { isElevated, visibilityClause } = require('../utils/visibility');

// Booth-category line items carry sqm in qty; everything else (Corner,
// Loading, MEP, Sponsorship...) is a count, not floor space.
const EVENT_SCOPE = `IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)`;

async function getOverview(req, res) {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required.' });
  const params = [req.companyId, event_id];

  const [targetR, achievedR, sqmR, invoicedR, collectedR, eventR, trendR, countsR] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(target_myr),0) AS myr, COALESCE(SUM(target_sqm),0) AS sqm
       FROM sales_targets WHERE company_id = $1 AND event_id ${EVENT_SCOPE}`, params
    ),
    pool.query(
      `SELECT COALESCE(SUM(total_myr),0) AS myr, COUNT(*) AS contracts,
              COUNT(DISTINCT exhibitor_id) AS exhibitors
       FROM sales_orders
       WHERE company_id = $1 AND event_id ${EVENT_SCOPE} AND is_active = TRUE AND status = 'APPROVED'`, params
    ),
    pool.query(
      `SELECT COALESCE(SUM(soi.qty),0) AS sqm
       FROM sales_order_items soi
       JOIN sales_orders so ON so.id = soi.sales_order_id
       WHERE so.company_id = $1 AND so.event_id ${EVENT_SCOPE}
         AND so.is_active = TRUE AND so.status = 'APPROVED' AND soi.category = 'BOOTH'`, params
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount_myr),0) AS myr FROM invoices
       WHERE company_id = $1 AND event_id ${EVENT_SCOPE} AND status = 'CONFIRMED'`, params
    ),
    pool.query(
      `SELECT COALESCE(SUM(pa.amount_myr),0) AS myr
       FROM payment_allocations pa JOIN invoices inv ON inv.id = pa.invoice_id
       WHERE inv.company_id = $1 AND inv.event_id ${EVENT_SCOPE} AND inv.status = 'CONFIRMED'`, params
    ),
    pool.query(`SELECT start_date FROM events WHERE company_id = $1 AND id = $2`, params),
    // Monthly contracted + collected — frontend renders the cumulative curve.
    pool.query(
      `SELECT to_char(month, 'YYYY-MM') AS month,
              COALESCE(SUM(contracted),0) AS contracted, COALESCE(SUM(collected),0) AS collected
       FROM (
         SELECT date_trunc('month', contract_date) AS month, total_myr AS contracted, NULL::numeric AS collected
         FROM sales_orders
         WHERE company_id = $1 AND event_id ${EVENT_SCOPE} AND is_active = TRUE
           AND status = 'APPROVED' AND contract_date IS NOT NULL
         UNION ALL
         SELECT date_trunc('month', p.payment_date), NULL, pa.amount_myr
         FROM payment_allocations pa
         JOIN payments p ON p.id = pa.payment_id
         JOIN invoices inv ON inv.id = pa.invoice_id
         WHERE inv.company_id = $1 AND inv.event_id ${EVENT_SCOPE} AND inv.status = 'CONFIRMED'
       ) t GROUP BY month ORDER BY month`, params
    ),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE st.is_won) AS won,
              COUNT(*) FILTER (WHERE NOT st.is_won AND NOT st.is_lost) AS open
       FROM opportunities o JOIN sales_stages st ON st.id = o.stage_id
       WHERE o.company_id = $1 AND o.event_id ${EVENT_SCOPE} AND o.is_active = TRUE`, params
    ),
  ]);

  const target = targetR.rows[0];
  const achieved = achievedR.rows[0];
  const invoiced = Number(invoicedR.rows[0].myr);
  const collected = Number(collectedR.rows[0].myr);
  const startDate = eventR.rows[0] ? eventR.rows[0].start_date : null;
  const daysToEvent = startDate
    ? Math.ceil((new Date(startDate) - new Date()) / (1000 * 60 * 60 * 24))
    : null;

  res.json({
    target: { myr: Number(target.myr), sqm: Number(target.sqm) },
    achieved: {
      myr: Number(achieved.myr),
      sqm: Number(sqmR.rows[0].sqm),
      contracts: Number(achieved.contracts),
      exhibitors: Number(achieved.exhibitors),
    },
    invoiced,
    collected,
    outstanding: invoiced - collected,
    daysToEvent,
    eventStartDate: startDate,
    monthlyTrend: trendR.rows.map((r) => ({
      month: r.month,
      contracted: Number(r.contracted),
      collected: Number(r.collected),
    })),
    opportunities: { won: Number(countsR.rows[0].won), open: Number(countsR.rows[0].open) },
  });
}

async function getBySalesperson(req, res) {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required.' });

  // Salespeople see their own row only; Admin/Management see the whole team.
  const ownOnly = !isElevated(req);
  const params = [req.companyId, event_id];
  let userFilter = '';
  if (ownOnly) {
    params.push(req.userId);
    userFilter = 'AND u.id = $3';
  }

  const result = await pool.query(
    `SELECT u.id, u.full_name,
            COALESCE(t.target_myr, 0)  AS target_myr,
            COALESCE(t.target_sqm, 0)  AS target_sqm,
            COALESCE(c.contracted_myr, 0) AS contracted_myr,
            COALESCE(c.contracts, 0)      AS contracts,
            COALESCE(sq.sqm, 0)           AS sqm,
            COALESCE(f.invoiced_myr, 0)   AS invoiced_myr,
            COALESCE(f.collected_myr, 0)  AS collected_myr,
            COALESCE(pl.pipeline_myr, 0)  AS pipeline_myr,
            COALESCE(pl.open_opps, 0)     AS open_opps
     FROM users u
     LEFT JOIN sales_targets t
       ON t.user_id = u.id AND t.company_id = $1 AND t.event_id ${EVENT_SCOPE}
     LEFT JOIN LATERAL (
       SELECT SUM(so.total_myr) AS contracted_myr, COUNT(*) AS contracts
       FROM sales_orders so
       WHERE so.salesperson_id = u.id AND so.company_id = $1 AND so.event_id ${EVENT_SCOPE}
         AND so.is_active = TRUE AND so.status = 'APPROVED'
     ) c ON TRUE
     LEFT JOIN LATERAL (
       SELECT SUM(soi.qty) AS sqm
       FROM sales_order_items soi JOIN sales_orders so ON so.id = soi.sales_order_id
       WHERE so.salesperson_id = u.id AND so.company_id = $1 AND so.event_id ${EVENT_SCOPE}
         AND so.is_active = TRUE AND so.status = 'APPROVED' AND soi.category = 'BOOTH'
     ) sq ON TRUE
     LEFT JOIN LATERAL (
       SELECT SUM(inv.amount_myr) AS invoiced_myr,
              SUM((SELECT COALESCE(SUM(pa.amount_myr),0) FROM payment_allocations pa WHERE pa.invoice_id = inv.id)) AS collected_myr
       FROM invoices inv JOIN sales_orders so ON so.id = inv.sales_order_id
       WHERE so.salesperson_id = u.id AND inv.company_id = $1 AND inv.event_id ${EVENT_SCOPE}
         AND inv.status = 'CONFIRMED'
     ) f ON TRUE
     LEFT JOIN LATERAL (
       SELECT SUM(o.estimated_value_myr) AS pipeline_myr, COUNT(*) AS open_opps
       FROM opportunities o JOIN sales_stages st ON st.id = o.stage_id
       WHERE o.salesperson_id = u.id AND o.company_id = $1 AND o.event_id ${EVENT_SCOPE}
         AND o.is_active = TRUE AND NOT st.is_won AND NOT st.is_lost
     ) pl ON TRUE
     WHERE u.company_id = $1 AND u.is_active = TRUE ${userFilter}
       AND (t.id IS NOT NULL OR c.contracted_myr IS NOT NULL OR pl.pipeline_myr IS NOT NULL)
     ORDER BY contracted_myr DESC NULLS LAST, u.full_name`,
    params
  );

  res.json({
    ownOnly,
    rows: result.rows.map((r) => ({
      user_id: r.id,
      name: r.full_name,
      target_myr: Number(r.target_myr),
      target_sqm: Number(r.target_sqm),
      contracted_myr: Number(r.contracted_myr),
      contracts: Number(r.contracts),
      sqm: Number(r.sqm),
      invoiced_myr: Number(r.invoiced_myr),
      collected_myr: Number(r.collected_myr),
      outstanding_myr: Number(r.invoiced_myr) - Number(r.collected_myr),
      pipeline_myr: Number(r.pipeline_myr),
      open_opps: Number(r.open_opps),
      achieved_pct: Number(r.target_myr) > 0 ? (Number(r.contracted_myr) / Number(r.target_myr)) * 100 : null,
    })),
  });
}

async function getByItem(req, res) {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required.' });

  // Line totals are stored in the contract's currency — multiply by the
  // contract's exchange rate to report everything in MYR.
  const result = await pool.query(
    `SELECT soi.sales_item_code AS code,
            MIN(soi.description) AS description,
            MIN(soi.category)    AS category,
            SUM(CASE WHEN ex.country_code = 'MY' THEN soi.line_total * so.exchange_rate ELSE 0 END) AS myr_local,
            SUM(CASE WHEN ex.country_code IS DISTINCT FROM 'MY' THEN soi.line_total * so.exchange_rate ELSE 0 END) AS myr_int,
            SUM(CASE WHEN soi.category = 'BOOTH' AND ex.country_code = 'MY' THEN soi.qty ELSE 0 END) AS sqm_local,
            SUM(CASE WHEN soi.category = 'BOOTH' AND ex.country_code IS DISTINCT FROM 'MY' THEN soi.qty ELSE 0 END) AS sqm_int
     FROM sales_order_items soi
     JOIN sales_orders so ON so.id = soi.sales_order_id
     JOIN exhibitors ex ON ex.id = so.exhibitor_id
     WHERE so.company_id = $1 AND so.event_id ${EVENT_SCOPE}
       AND so.is_active = TRUE AND so.status = 'APPROVED'
     GROUP BY soi.sales_item_code
     ORDER BY (SUM(soi.line_total * so.exchange_rate)) DESC`,
    [req.companyId, event_id]
  );

  res.json({
    rows: result.rows.map((r) => ({
      code: r.code,
      description: r.description,
      category: r.category,
      myr_local: Number(r.myr_local),
      myr_int: Number(r.myr_int),
      myr_total: Number(r.myr_local) + Number(r.myr_int),
      sqm_local: Number(r.sqm_local),
      sqm_int: Number(r.sqm_int),
      sqm_total: Number(r.sqm_local) + Number(r.sqm_int),
    })),
  });
}

async function getPipeline(req, res) {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required.' });

  const vis = visibilityClause(req, 'o.salesperson_id', 3);
  const params = [req.companyId, event_id];
  if (vis.param !== undefined) params.push(vis.param);

  const result = await pool.query(
    `SELECT st.id, st.code, st.name, st.sort_order, st.is_won, st.is_lost,
            COUNT(o.id) AS count,
            COALESCE(SUM(o.estimated_value_myr),0) AS value_myr,
            COALESCE(SUM(o.booth_sqm),0) AS sqm
     FROM sales_stages st
     LEFT JOIN opportunities o
       ON o.stage_id = st.id AND o.company_id = $1 AND o.event_id ${EVENT_SCOPE}
      AND o.is_active = TRUE AND ${vis.sql}
     WHERE st.company_id = $1
     GROUP BY st.id, st.code, st.name, st.sort_order, st.is_won, st.is_lost
     ORDER BY st.sort_order`,
    params
  );

  res.json({
    stages: result.rows.map((r) => ({
      code: r.code,
      name: r.name,
      is_won: r.is_won,
      is_lost: r.is_lost,
      count: Number(r.count),
      value_myr: Number(r.value_myr),
      sqm: Number(r.sqm),
    })),
  });
}

async function getComparison(req, res) {
  const { event_id, compare_event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required.' });

  // Both series are aligned by "months relative to event start" so two
  // events in different years line up on the same axis.
  const seriesFor = async (evId) => {
    const evR = await pool.query(
      `SELECT code, name, start_date FROM events WHERE company_id = $1 AND id = $2`,
      [req.companyId, evId]
    );
    if (!evR.rows[0]) return null;
    const ev = evR.rows[0];

    const rowsR = await pool.query(
      `SELECT to_char(month, 'YYYY-MM') AS month,
              COALESCE(SUM(contracted),0) AS contracted, COALESCE(SUM(collected),0) AS collected
       FROM (
         SELECT date_trunc('month', contract_date) AS month, total_myr AS contracted, NULL::numeric AS collected
         FROM sales_orders
         WHERE company_id = $1 AND event_id ${EVENT_SCOPE} AND is_active = TRUE
           AND status = 'APPROVED' AND contract_date IS NOT NULL
         UNION ALL
         SELECT date_trunc('month', p.payment_date), NULL, pa.amount_myr
         FROM payment_allocations pa
         JOIN payments p ON p.id = pa.payment_id
         JOIN invoices inv ON inv.id = pa.invoice_id
         WHERE inv.company_id = $1 AND inv.event_id ${EVENT_SCOPE} AND inv.status = 'CONFIRMED'
       ) t GROUP BY month ORDER BY month`,
      [req.companyId, evId]
    );

    const start = ev.start_date ? new Date(ev.start_date) : null;
    let cumC = 0;
    let cumP = 0;
    const points = rowsR.rows.map((r) => {
      cumC += Number(r.contracted);
      cumP += Number(r.collected);
      const [y, m] = r.month.split('-').map(Number);
      const offset = start ? (y - start.getFullYear()) * 12 + (m - 1 - start.getMonth()) : null;
      return { month: r.month, offset, contracted: cumC, collected: cumP };
    });
    return { event: { id: evId, code: ev.code, name: ev.name, start_date: ev.start_date }, points };
  };

  const primary = await seriesFor(event_id);
  if (!primary) return res.status(404).json({ error: 'Event not found.' });
  const compare = compare_event_id ? await seriesFor(compare_event_id) : null;

  res.json({ primary, compare });
}

async function getByCountry(req, res) {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required.' });

  const result = await pool.query(
    `SELECT COALESCE(ex.country_code, '—') AS code,
            COALESCE(cy.name, 'Unspecified') AS country,
            COUNT(DISTINCT so.exhibitor_id) AS exhibitors,
            COUNT(*) AS contracts,
            COALESCE(SUM(so.total_myr),0) AS contracted_myr,
            COALESCE(SUM(sq.sqm),0) AS sqm
     FROM sales_orders so
     JOIN exhibitors ex ON ex.id = so.exhibitor_id
     LEFT JOIN countries cy ON cy.code = ex.country_code
     LEFT JOIN LATERAL (
       SELECT SUM(soi.qty) AS sqm FROM sales_order_items soi
       WHERE soi.sales_order_id = so.id AND soi.category = 'BOOTH'
     ) sq ON TRUE
     WHERE so.company_id = $1 AND so.event_id ${EVENT_SCOPE}
       AND so.is_active = TRUE AND so.status = 'APPROVED'
     GROUP BY ex.country_code, cy.name
     ORDER BY contracted_myr DESC`,
    [req.companyId, event_id]
  );

  res.json({
    rows: result.rows.map((r) => ({
      code: r.code,
      country: r.country,
      type: r.code === 'MY' ? 'LOCAL' : 'INT',
      exhibitors: Number(r.exhibitors),
      contracts: Number(r.contracts),
      contracted_myr: Number(r.contracted_myr),
      sqm: Number(r.sqm),
    })),
  });
}

async function getByMonth(req, res) {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required.' });

  const result = await pool.query(
    `SELECT to_char(month, 'YYYY-MM') AS month,
            COALESCE(SUM(contracted),0) AS contracted,
            COALESCE(SUM(invoiced),0)   AS invoiced,
            COALESCE(SUM(collected),0)  AS collected
     FROM (
       SELECT date_trunc('month', contract_date) AS month, total_myr AS contracted,
              NULL::numeric AS invoiced, NULL::numeric AS collected
       FROM sales_orders
       WHERE company_id = $1 AND event_id ${EVENT_SCOPE} AND is_active = TRUE
         AND status = 'APPROVED' AND contract_date IS NOT NULL
       UNION ALL
       SELECT date_trunc('month', invoice_date), NULL, amount_myr, NULL
       FROM invoices
       WHERE company_id = $1 AND event_id ${EVENT_SCOPE} AND status = 'CONFIRMED'
       UNION ALL
       SELECT date_trunc('month', p.payment_date), NULL, NULL, pa.amount_myr
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       JOIN invoices inv ON inv.id = pa.invoice_id
       WHERE inv.company_id = $1 AND inv.event_id ${EVENT_SCOPE} AND inv.status = 'CONFIRMED'
     ) t GROUP BY month ORDER BY month`,
    [req.companyId, event_id]
  );

  res.json({
    rows: result.rows.map((r) => ({
      month: r.month,
      contracted: Number(r.contracted),
      invoiced: Number(r.invoiced),
      collected: Number(r.collected),
    })),
  });
}

async function getTargets(req, res) {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required.' });

  const result = await pool.query(
    `SELECT u.id AS user_id, u.full_name,
            COALESCE(t.target_myr, 0) AS target_myr, COALESCE(t.target_sqm, 0) AS target_sqm
     FROM users u
     LEFT JOIN sales_targets t ON t.user_id = u.id AND t.company_id = $1 AND t.event_id = $2
     WHERE u.company_id = $1 AND u.is_active = TRUE
     ORDER BY u.full_name`,
    [req.companyId, event_id]
  );
  res.json({ rows: result.rows });
}

async function saveTargets(req, res) {
  if (req.roleCode !== 'ADM') {
    return res.status(403).json({ error: 'Only Admin can set sales targets.' });
  }
  const { event_id, targets } = req.body;
  if (!event_id || !Array.isArray(targets)) {
    return res.status(400).json({ error: 'event_id and targets[] are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const t of targets) {
      await client.query(
        `INSERT INTO sales_targets (company_id, event_id, user_id, target_myr, target_sqm)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (company_id, event_id, user_id)
         DO UPDATE SET target_myr = EXCLUDED.target_myr, target_sqm = EXCLUDED.target_sqm`,
        [req.companyId, event_id, t.user_id, Number(t.target_myr) || 0, Number(t.target_sqm) || 0]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  res.json({ ok: true });
}

module.exports = { getOverview, getBySalesperson, getByItem, getPipeline, getComparison, getByCountry, getByMonth, getTargets, saveTargets };
