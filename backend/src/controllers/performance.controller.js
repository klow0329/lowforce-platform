// Performance Reports — replaces the Excel "MIFB26 SALES REPORT" tab.
// Achieved/contracted figures count APPROVED, active contracts only (drafts
// and pending-approval contracts are pipeline, not achievement); invoiced
// figures count CONFIRMED invoices only. All figures are event-scoped
// (main event + sub-events, same pattern as the Dashboard).
const { pool } = require('../config/db');
const { isElevated, visibilityClause } = require('../utils/visibility');
const { getPrimaryBaseCode } = require('../utils/priceListHelpers');

// "Total Sqm" is always sales_orders.total_sqm / opportunities.total_sqm —
// the one field Sales actually enters for "how much physical space does
// this deal cover" (see the booth mass-pickup feature). It is NOT derived
// from summing category='BOOTH' line items' qty: Bare Space's qty already
// equals the full total_sqm, and an Upgrade item (Shell Scheme, Enhanced
// Shell...) mirrors that SAME sqm to price its surcharge on the same
// space — summing both would double-count the floor space 2x on any
// contract with an upgrade selected. Per-item sqm breakdowns (which upgrade
// type covers how much of the total, for revenue/sqm analysis) still come
// from line items — see getByItem, which is a by-item report, not a total.
const EVENT_SCOPE = `IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)`;

async function getOverview(req, res) {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required.' });
  const params = [req.companyId, event_id];

  const [targetR, achievedR, sqmR, invoicedR, collectedR, eventR, trendR, countsR, byTypeR, bySegmentR] = await Promise.all([
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
      `SELECT COALESCE(SUM(total_sqm),0) AS sqm
       FROM sales_orders
       WHERE company_id = $1 AND event_id ${EVENT_SCOPE}
         AND is_active = TRUE AND status = 'APPROVED'`, params
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount_myr),0) AS myr FROM invoices
       WHERE company_id = $1 AND event_id ${EVENT_SCOPE} AND status = 'CONFIRMED' AND is_active = TRUE`, params
    ),
    pool.query(
      `SELECT COALESCE(SUM(pa.amount_myr),0) AS myr
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       JOIN invoices inv ON inv.id = pa.invoice_id
       WHERE inv.company_id = $1 AND inv.event_id ${EVENT_SCOPE} AND inv.status = 'CONFIRMED' AND inv.is_active = TRUE
         AND p.is_active = TRUE`, params
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
           AND inv.is_active = TRUE AND p.is_active = TRUE
       ) t GROUP BY month ORDER BY month`, params
    ),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE st.is_won) AS won,
              COUNT(*) FILTER (WHERE NOT st.is_won AND NOT st.is_lost) AS open
       FROM opportunities o JOIN sales_stages st ON st.id = o.stage_id
       WHERE o.company_id = $1 AND o.event_id ${EVENT_SCOPE} AND o.is_active = TRUE`, params
    ),
    // Local (Malaysia) vs International split — same MY-code rule as
    // getByCountry/getByItem, rolled up into just the two buckets so the
    // whole-company Overview page doesn't need its own By Country trip.
    pool.query(
      `SELECT CASE WHEN ex.country_code = 'MY' THEN 'LOCAL' ELSE 'INT' END AS type,
              COUNT(*) AS contracts, COALESCE(SUM(so.total_myr),0) AS myr, COALESCE(SUM(so.total_sqm),0) AS sqm
       FROM sales_orders so JOIN exhibitors ex ON ex.id = so.exhibitor_id
       WHERE so.company_id = $1 AND so.event_id ${EVENT_SCOPE} AND so.is_active = TRUE AND so.status = 'APPROVED'
       GROUP BY 1`, params
    ),
    // By Segment — an exhibitor can carry more than one segment tag, so its
    // contract value counts toward each (same convention as any CRM segment
    // breakdown); unsegmented exhibitors roll into "Unsegmented".
    pool.query(
      `SELECT COALESCE(sm.name, 'UNSEGMENTED') AS segment,
              COUNT(DISTINCT so.id) AS contracts, COALESCE(SUM(so.total_myr),0) AS myr, COALESCE(SUM(so.total_sqm),0) AS sqm
       FROM sales_orders so
       JOIN exhibitors ex ON ex.id = so.exhibitor_id
       LEFT JOIN exhibitor_segments es ON es.exhibitor_id = ex.id
       LEFT JOIN segment_main sm ON sm.id = es.segment_main_id
       WHERE so.company_id = $1 AND so.event_id ${EVENT_SCOPE} AND so.is_active = TRUE AND so.status = 'APPROVED'
       GROUP BY 1 ORDER BY myr DESC`, params
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
    byType: (() => {
      const byCode = Object.fromEntries(byTypeR.rows.map((r) => [r.type, r]));
      const pick = (r) => ({ contracts: Number(r?.contracts || 0), myr: Number(r?.myr || 0), sqm: Number(r?.sqm || 0) });
      return { local: pick(byCode.LOCAL), international: pick(byCode.INT) };
    })(),
    bySegment: bySegmentR.rows.map((r) => ({
      segment: r.segment, contracts: Number(r.contracts), myr: Number(r.myr), sqm: Number(r.sqm),
    })),
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
            COALESCE(c.sqm, 0)            AS sqm,
            COALESCE(f.invoiced_myr, 0)   AS invoiced_myr,
            COALESCE(f.collected_myr, 0)  AS collected_myr,
            COALESCE(pl.pipeline_myr, 0)  AS pipeline_myr,
            COALESCE(pl.open_opps, 0)     AS open_opps
     FROM users u
     LEFT JOIN sales_targets t
       ON t.user_id = u.id AND t.company_id = $1 AND t.event_id ${EVENT_SCOPE}
     LEFT JOIN LATERAL (
       SELECT SUM(so.total_myr) AS contracted_myr, COUNT(*) AS contracts, SUM(so.total_sqm) AS sqm
       FROM sales_orders so
       WHERE so.salesperson_id = u.id AND so.company_id = $1 AND so.event_id ${EVENT_SCOPE}
         AND so.is_active = TRUE AND so.status = 'APPROVED'
     ) c ON TRUE
     LEFT JOIN LATERAL (
       SELECT SUM(inv.amount_myr) AS invoiced_myr,
              SUM((SELECT COALESCE(SUM(pa.amount_myr),0) FROM payment_allocations pa
                   JOIN payments p ON p.id = pa.payment_id
                   WHERE pa.invoice_id = inv.id AND p.is_active = TRUE)) AS collected_myr
       FROM invoices inv JOIN sales_orders so ON so.id = inv.sales_order_id
       WHERE so.salesperson_id = u.id AND inv.company_id = $1 AND inv.event_id ${EVENT_SCOPE}
         AND inv.status = 'CONFIRMED' AND inv.is_active = TRUE
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

// Agent Analysis — the same shape as By Salesperson, but rolled up by
// agent (via exhibitors.agent_id) instead of by the internal salesperson.
// No target row (targets are a salesperson concept, not an agent one).
async function getByAgent(req, res) {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required.' });

  const result = await pool.query(
    `SELECT ag.id, ag.name,
            COALESCE(c.contracted_myr, 0) AS contracted_myr,
            COALESCE(c.contracts, 0)      AS contracts,
            COALESCE(c.sqm, 0)            AS sqm,
            COALESCE(c.exhibitors, 0)     AS exhibitors,
            COALESCE(f.invoiced_myr, 0)   AS invoiced_myr,
            COALESCE(f.collected_myr, 0)  AS collected_myr,
            COALESCE(pl.pipeline_myr, 0)  AS pipeline_myr,
            COALESCE(pl.open_opps, 0)     AS open_opps
     FROM agents ag
     LEFT JOIN LATERAL (
       SELECT SUM(so.total_myr) AS contracted_myr, COUNT(*) AS contracts, SUM(so.total_sqm) AS sqm,
              COUNT(DISTINCT so.exhibitor_id) AS exhibitors
       FROM sales_orders so JOIN exhibitors ex ON ex.id = so.exhibitor_id
       WHERE ex.agent_id = ag.id AND so.company_id = $1 AND so.event_id ${EVENT_SCOPE}
         AND so.is_active = TRUE AND so.status = 'APPROVED'
     ) c ON TRUE
     LEFT JOIN LATERAL (
       SELECT SUM(inv.amount_myr) AS invoiced_myr,
              SUM((SELECT COALESCE(SUM(pa.amount_myr),0) FROM payment_allocations pa
                   JOIN payments p ON p.id = pa.payment_id
                   WHERE pa.invoice_id = inv.id AND p.is_active = TRUE)) AS collected_myr
       FROM invoices inv JOIN exhibitors ex ON ex.id = inv.exhibitor_id
       WHERE ex.agent_id = ag.id AND inv.company_id = $1 AND inv.event_id ${EVENT_SCOPE}
         AND inv.status = 'CONFIRMED' AND inv.is_active = TRUE
     ) f ON TRUE
     LEFT JOIN LATERAL (
       SELECT SUM(o.estimated_value_myr) AS pipeline_myr, COUNT(*) AS open_opps
       FROM opportunities o JOIN sales_stages st ON st.id = o.stage_id JOIN exhibitors ex ON ex.id = o.exhibitor_id
       WHERE ex.agent_id = ag.id AND o.company_id = $1 AND o.event_id ${EVENT_SCOPE}
         AND o.is_active = TRUE AND NOT st.is_won AND NOT st.is_lost
     ) pl ON TRUE
     WHERE ag.company_id = $1 AND ag.is_active = TRUE
       AND (c.contracted_myr IS NOT NULL OR pl.pipeline_myr IS NOT NULL)
     ORDER BY contracted_myr DESC NULLS LAST, ag.name`,
    [req.companyId, event_id]
  );

  res.json({
    rows: result.rows.map((r) => ({
      agent_id: r.id,
      name: r.name,
      contracted_myr: Number(r.contracted_myr),
      contracts: Number(r.contracts),
      sqm: Number(r.sqm),
      exhibitors: Number(r.exhibitors),
      invoiced_myr: Number(r.invoiced_myr),
      collected_myr: Number(r.collected_myr),
      outstanding_myr: Number(r.invoiced_myr) - Number(r.collected_myr),
      pipeline_myr: Number(r.pipeline_myr),
      open_opps: Number(r.open_opps),
    })),
  });
}

async function getByItem(req, res) {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required.' });

  // Line totals are stored in the contract's currency — multiply by the
  // contract's exchange rate to report everything in MYR.
  //
  // A large share of approved contracts (legacy/bulk-imported before the
  // itemized billing template existed — see database/migrations/050) carry
  // a real total_myr/total_sqm on the contract itself but have NO
  // sales_order_items rows at all, so a plain item-table query silently
  // skips them entirely — this was making the whole report undercount by
  // roughly two orders of magnitude, not overcount as previously assumed.
  // The legacy CTE below folds each such contract in as a single synthetic
  // "Bare Space" row (the one thing we can say for certain about an
  // unitemized legacy contract, per the standing rule that Total Sqm is
  // always Bare Space) so this report's totals actually reconcile with
  // Overview's Total Sqm.
  //
  // An Upgrade item (Shell Scheme, Enhanced Shell, Walk-On Package, Custom
  // Build) is priced on the SAME physical footprint as part of Bare Space,
  // not extra space on top — an upgraded booth is no longer Bare Space, it
  // IS the upgrade type now. So each contract's Bare Space row must be
  // reduced by however much of its total_sqm has been reclassified into
  // upgrade rows (upgrade_totals CTE), leaving only the genuinely-unupgraded
  // portion as Bare Space. Without this, Bare Space's qty (which mirrors the
  // contract's full total_sqm) plus every upgrade row's qty (which mirrors
  // that same sqm again) double- or triple-counts the same floor space, and
  // this report's grand total no longer reconciles with Overview's Total Sqm.
  const result = await pool.query(
    `WITH items AS (
       SELECT soi.sales_order_id, soi.sales_item_code AS code, soi.description, soi.category, soi.line_total, soi.qty,
              so.exchange_rate, ex.country_code
       FROM sales_order_items soi
       JOIN sales_orders so ON so.id = soi.sales_order_id
       JOIN exhibitors ex ON ex.id = so.exhibitor_id
       WHERE so.company_id = $1 AND so.event_id ${EVENT_SCOPE}
         AND so.is_active = TRUE AND so.status = 'APPROVED'
     ),
     upgrade_totals AS (
       SELECT sales_order_id, SUM(qty) AS upgrade_sqm
       FROM items WHERE category = 'BOOTH' AND code <> 'BAS'
       GROUP BY sales_order_id
     ),
     per_item AS (
       SELECT i.code, i.description, i.category, i.country_code,
              CASE WHEN i.country_code = 'MY' THEN i.line_total * i.exchange_rate ELSE 0 END AS myr_local,
              CASE WHEN i.country_code IS DISTINCT FROM 'MY' THEN i.line_total * i.exchange_rate ELSE 0 END AS myr_int,
              CASE
                WHEN i.category <> 'BOOTH' THEN 0
                WHEN i.code = 'BAS' THEN GREATEST(i.qty - COALESCE(ut.upgrade_sqm, 0), 0)
                ELSE i.qty
              END AS booth_sqm
       FROM items i
       LEFT JOIN upgrade_totals ut ON ut.sales_order_id = i.sales_order_id
     ),
     legacy AS (
       SELECT 'BAS' AS code, 'BARE SPACE (unitemized legacy contract)' AS description, 'BOOTH' AS category,
              ex.country_code,
              CASE WHEN ex.country_code = 'MY' THEN so.total_myr ELSE 0 END AS myr_local,
              CASE WHEN ex.country_code IS DISTINCT FROM 'MY' THEN so.total_myr ELSE 0 END AS myr_int,
              COALESCE(so.total_sqm, 0) AS booth_sqm
       FROM sales_orders so
       JOIN exhibitors ex ON ex.id = so.exhibitor_id
       WHERE so.company_id = $1 AND so.event_id ${EVENT_SCOPE}
         AND so.is_active = TRUE AND so.status = 'APPROVED'
         AND NOT EXISTS (SELECT 1 FROM sales_order_items x WHERE x.sales_order_id = so.id)
     )
     SELECT code, MIN(description) AS description, MIN(category) AS category,
            SUM(myr_local) AS myr_local, SUM(myr_int) AS myr_int,
            SUM(CASE WHEN country_code = 'MY' THEN booth_sqm ELSE 0 END) AS sqm_local,
            SUM(CASE WHEN country_code IS DISTINCT FROM 'MY' THEN booth_sqm ELSE 0 END) AS sqm_int
     FROM (
       SELECT code, description, category, country_code, myr_local, myr_int, booth_sqm FROM per_item
       UNION ALL
       SELECT code, description, category, country_code, myr_local, myr_int, booth_sqm FROM legacy
     ) t
     GROUP BY code
     ORDER BY (SUM(myr_local) + SUM(myr_int)) DESC`,
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
            COALESCE(SUM(o.total_sqm),0) AS sqm
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
           AND inv.is_active = TRUE AND p.is_active = TRUE
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
            COALESCE(SUM(so.total_sqm),0) AS sqm
     FROM sales_orders so
     JOIN exhibitors ex ON ex.id = so.exhibitor_id
     LEFT JOIN countries cy ON cy.code = ex.country_code
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
       WHERE company_id = $1 AND event_id ${EVENT_SCOPE} AND status = 'CONFIRMED' AND is_active = TRUE
       UNION ALL
       SELECT date_trunc('month', p.payment_date), NULL, NULL, pa.amount_myr
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       JOIN invoices inv ON inv.id = pa.invoice_id
       WHERE inv.company_id = $1 AND inv.event_id ${EVENT_SCOPE} AND inv.status = 'CONFIRMED'
         AND inv.is_active = TRUE AND p.is_active = TRUE
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

// Agent commission — computed against actually CONFIRMED invoices (real
// billed revenue in the invoice's own currency, not the contract's paper
// estimate), per the user's own requirement. Each invoice is prorated
// across the contract's own ITEM CODES (not a broad Booth/Non-Booth split —
// the rate table now keys on the specific code, e.g. a different % for BAS
// vs SSS vs MEP), since a milestone invoice is a proportional slice of the
// whole contract rather than tied to specific line items. A rate lookup
// falls back to the agent's 'ALL' rate (a catch-all) when no rate is set
// for that specific code, then to 0. The agent's own rate table
// (agent_commission_rates) is applied using whether the exhibitor is
// flagged repeat or new. A contract with no line items at all (see
// getByItem's identical note — a legacy/bulk-imported contract predating
// itemized billing) is treated as 100% Bare Space (BAS), the one thing
// known for certain about it. On top of the base commission, an agent's
// threshold bonus tiers (agent_commission_bonus_tiers) are checked once per
// agent against their TOTAL revenue (MYR) and sqm across every
// commission-eligible invoice for this event — see the summary block below.
async function getAgentCommission(req, res) {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required.' });

  const invoicesResult = await pool.query(
    `SELECT inv.id AS invoice_id, inv.invoice_no, inv.amount_foreign, inv.currency, inv.amount_myr,
            so.id AS sales_order_id, so.total_foreign AS contract_total_foreign, so.total_sqm AS contract_total_sqm,
            ex.id AS exhibitor_id, ex.company_name AS exhibitor_name, ex.is_repeat_exhibitor,
            ex.agent_id, ag.name AS agent_name
     FROM invoices inv
     JOIN sales_orders so ON so.id = inv.sales_order_id
     JOIN exhibitors ex ON ex.id = inv.exhibitor_id
     JOIN agents ag ON ag.id = ex.agent_id
     WHERE inv.company_id = $1 AND inv.event_id ${EVENT_SCOPE}
       AND inv.status = 'CONFIRMED' AND inv.is_active = TRUE AND ex.agent_id IS NOT NULL
     ORDER BY ag.name, ex.company_name, inv.invoice_date`,
    [req.companyId, event_id]
  );

  const soIds = [...new Set(invoicesResult.rows.map((r) => r.sales_order_id))];
  const itemsResult = soIds.length > 0
    ? await pool.query(
        `SELECT sales_order_id, sales_item_code AS code, SUM(line_total) AS total
         FROM sales_order_items WHERE sales_order_id = ANY($1::uuid[])
         GROUP BY sales_order_id, sales_item_code`,
        [soIds]
      )
    : { rows: [] };
  const ratesResult = await pool.query(
    `SELECT agent_id, item_code, exhibitor_tier, rate_pct FROM agent_commission_rates WHERE company_id = $1`,
    [req.companyId]
  );
  const bonusResult = await pool.query(
    `SELECT agent_id, threshold_type, threshold_value, bonus_pct
     FROM agent_commission_bonus_tiers WHERE company_id = $1 ORDER BY threshold_value`,
    [req.companyId]
  );

  const itemTotalsBySo = {};
  for (const row of itemsResult.rows) {
    itemTotalsBySo[row.sales_order_id] = itemTotalsBySo[row.sales_order_id] || {};
    itemTotalsBySo[row.sales_order_id][row.code] = Number(row.total);
  }
  const rateMap = {};
  for (const r of ratesResult.rows) {
    rateMap[r.agent_id] = rateMap[r.agent_id] || {};
    rateMap[r.agent_id][r.item_code] = rateMap[r.agent_id][r.item_code] || {};
    rateMap[r.agent_id][r.item_code][r.exhibitor_tier] = Number(r.rate_pct);
  }
  function lookupRate(agentId, code, tier) {
    return rateMap[agentId]?.[code]?.[tier] ?? rateMap[agentId]?.ALL?.[tier] ?? 0;
  }

  const rows = [];
  for (const inv of invoicesResult.rows) {
    let itemTotals = itemTotalsBySo[inv.sales_order_id];
    let contractTotal;
    if (!itemTotals || Object.keys(itemTotals).length === 0) {
      contractTotal = Number(inv.contract_total_foreign) || 0;
      itemTotals = { BAS: contractTotal };
    } else {
      contractTotal = Object.values(itemTotals).reduce((s, v) => s + v, 0);
    }
    if (!(contractTotal > 0)) continue;

    const tier = inv.is_repeat_exhibitor ? 'REPEAT' : 'NEW';
    const invoiceAmount = Number(inv.amount_foreign);
    const proration = invoiceAmount / contractTotal;
    let commissionForeign = 0;
    const breakdown = [];
    for (const [code, codeTotal] of Object.entries(itemTotals)) {
      const proportion = codeTotal / contractTotal;
      const codeInvoiceAmount = invoiceAmount * proportion;
      const rate = lookupRate(inv.agent_id, code, tier);
      const codeCommission = codeInvoiceAmount * (rate / 100);
      if (rate > 0) breakdown.push({ item_code: code, amount_foreign: codeInvoiceAmount, rate_pct: rate, commission_foreign: codeCommission });
      commissionForeign += codeCommission;
    }
    // This invoice's share of the contract's physical sqm — used only for
    // an agent's SQM bonus threshold, not for the commission itself.
    const sqm = (Number(inv.contract_total_sqm) || 0) * proration;

    rows.push({
      invoice_id: inv.invoice_id, invoice_no: inv.invoice_no,
      agent_id: inv.agent_id, agent_name: inv.agent_name,
      exhibitor_id: inv.exhibitor_id, exhibitor_name: inv.exhibitor_name,
      is_repeat_exhibitor: inv.is_repeat_exhibitor,
      currency: inv.currency, invoice_amount: invoiceAmount, amount_myr: Number(inv.amount_myr) || 0, sqm,
      commission: commissionForeign, breakdown,
    });
  }

  // Subtotal per agent, kept in each invoice's own currency (never
  // converted) — the user's own requirement, since an agent is paid in
  // whatever currency their exhibitors were actually billed in. Bonus
  // tiers are the one exception: a threshold has to compare a single
  // number, so it's checked against the agent's total MYR/sqm and, once
  // crossed, paid out in MYR — not blended into the native-currency
  // commission above.
  const byAgent = {};
  for (const r of rows) {
    if (!byAgent[r.agent_id]) {
      byAgent[r.agent_id] = { agent_id: r.agent_id, agent_name: r.agent_name, byCurrency: {}, totalMyr: 0, totalSqm: 0 };
    }
    byAgent[r.agent_id].byCurrency[r.currency] = (byAgent[r.agent_id].byCurrency[r.currency] || 0) + r.commission;
    byAgent[r.agent_id].totalMyr += r.amount_myr;
    byAgent[r.agent_id].totalSqm += r.sqm;
  }
  const bonusTiersByAgent = {};
  for (const b of bonusResult.rows) {
    bonusTiersByAgent[b.agent_id] = bonusTiersByAgent[b.agent_id] || [];
    bonusTiersByAgent[b.agent_id].push(b);
  }
  for (const agent of Object.values(byAgent)) {
    agent.bonuses = [];
    for (const b of bonusTiersByAgent[agent.agent_id] || []) {
      const actual = b.threshold_type === 'SQM' ? agent.totalSqm : agent.totalMyr;
      if (actual >= Number(b.threshold_value)) {
        agent.bonuses.push({
          threshold_type: b.threshold_type,
          threshold_value: Number(b.threshold_value),
          bonus_pct: Number(b.bonus_pct),
          bonus_amount_myr: agent.totalMyr * (Number(b.bonus_pct) / 100),
        });
      }
    }
  }

  res.json({ rows, agentSummary: Object.values(byAgent) });
}

// Booth & Space Analysis — physical floor space, not revenue. Deliberately
// sourced from floor_plan_booths rather than sales_order_items: the Floor
// Plan is the single source of truth for booth allocation now (booth type
// is picked there, and Total Sqm on a Contract is derived from it), so
// counting the booths themselves is what actually reconciles with what
// Operations sees on the map. That also makes each booth exactly one row —
// no BAS-vs-upgrade double-counting to correct for (contrast getByItem,
// which works off line items and has to subtract upgrade sqm back out).
//
// A booth counts as allocated when it carries a Contract or Opportunity
// claim — same definition the Floor Plan's own hall tallies use. Contracted
// (sales_order) and Proposed (opportunity) are reported separately, since
// a proposal is not yet sold space.
async function getBoothSpace(req, res) {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required.' });

  // One row per allocated booth, tagged with who holds it, their country,
  // and which booth type it was tagged as on the Floor Plan picker. The
  // COALESCE(sales_order → opportunity) ordering matches listBooths: a
  // Contract claim outranks an Opportunity claim on the same booth.
  const allocatedCte = `
    WITH allocated AS (
      SELECT b.id, b.sqm,
             CASE WHEN b.sales_order_id IS NOT NULL THEN 'CONTRACTED' ELSE 'PROPOSED' END AS allocation_state,
             COALESCE(ex_so.country_code, ex_opp.country_code) AS country_code,
             COALESCE(
               (SELECT c.allocated_item_code FROM floor_plan_booth_claims c
                WHERE c.booth_id = b.id AND c.record_type = 'sales_order' AND c.record_id = b.sales_order_id AND c.released_at IS NULL),
               (SELECT c.allocated_item_code FROM floor_plan_booth_claims c
                WHERE c.booth_id = b.id AND c.record_type = 'opportunity' AND c.record_id = b.opportunity_id AND c.released_at IS NULL)
             ) AS item_code
      FROM floor_plan_booths b
      JOIN floor_plan_halls h ON h.id = b.hall_id
      LEFT JOIN sales_orders so ON so.id = b.sales_order_id AND so.is_active = TRUE
      LEFT JOIN exhibitors ex_so ON ex_so.id = so.exhibitor_id
      LEFT JOIN opportunities opp ON opp.id = b.opportunity_id AND opp.is_active = TRUE
      LEFT JOIN exhibitors ex_opp ON ex_opp.id = opp.exhibitor_id
      WHERE h.company_id = $1 AND h.event_id ${EVENT_SCOPE}
        AND (b.sales_order_id IS NOT NULL OR b.opportunity_id IS NOT NULL)
    )`;

  const params = [req.companyId, event_id];
  const [totalsR, byCountryR, byTypeR] = await Promise.all([
    // Whole-event capacity, so the allocated figures have a denominator.
    pool.query(
      `SELECT COUNT(*) AS total_booths, COALESCE(SUM(b.sqm), 0) AS total_sqm,
              COUNT(*) FILTER (WHERE b.sales_order_id IS NOT NULL OR b.opportunity_id IS NOT NULL) AS allocated_booths,
              COALESCE(SUM(b.sqm) FILTER (WHERE b.sales_order_id IS NOT NULL OR b.opportunity_id IS NOT NULL), 0) AS allocated_sqm,
              COUNT(*) FILTER (WHERE b.sales_order_id IS NOT NULL) AS contracted_booths,
              COALESCE(SUM(b.sqm) FILTER (WHERE b.sales_order_id IS NOT NULL), 0) AS contracted_sqm,
              COUNT(*) FILTER (WHERE b.sales_order_id IS NULL AND b.opportunity_id IS NOT NULL) AS proposed_booths,
              COALESCE(SUM(b.sqm) FILTER (WHERE b.sales_order_id IS NULL AND b.opportunity_id IS NOT NULL), 0) AS proposed_sqm
       FROM floor_plan_booths b
       JOIN floor_plan_halls h ON h.id = b.hall_id
       WHERE h.company_id = $1 AND h.event_id ${EVENT_SCOPE}`, params
    ),
    // Local vs International is derived per row from country_code, same
    // MY-vs-rest rule as getByCountry/getByItem — kept consistent so the
    // two reports don't disagree on what "local" means.
    pool.query(
      `${allocatedCte}
       SELECT COALESCE(a.country_code, '—') AS code,
              COALESCE(cy.name, 'Unspecified') AS country,
              CASE WHEN a.country_code = 'MY' THEN 'LOCAL' ELSE 'INT' END AS type,
              COUNT(*) AS booths, COALESCE(SUM(a.sqm), 0) AS sqm,
              COUNT(*) FILTER (WHERE a.allocation_state = 'CONTRACTED') AS contracted_booths,
              COALESCE(SUM(a.sqm) FILTER (WHERE a.allocation_state = 'CONTRACTED'), 0) AS contracted_sqm
       FROM allocated a
       LEFT JOIN countries cy ON cy.code = a.country_code
       GROUP BY a.country_code, cy.name
       ORDER BY sqm DESC`, params
    ),
    // Booth type = whatever the Floor Plan picker tagged (BAS/SSS/WOP/...),
    // joined to the Price List purely for its human-readable description.
    // An untagged booth falls back to the primary base item's code rather
    // than being dropped, so the type breakdown always reconciles with the
    // country breakdown above.
    pool.query(
      `${allocatedCte}
       SELECT COALESCE(a.item_code, $3) AS item_code,
              COUNT(*) AS booths, COALESCE(SUM(a.sqm), 0) AS sqm,
              COUNT(*) FILTER (WHERE a.allocation_state = 'CONTRACTED') AS contracted_booths,
              COALESCE(SUM(a.sqm) FILTER (WHERE a.allocation_state = 'CONTRACTED'), 0) AS contracted_sqm,
              COUNT(*) FILTER (WHERE a.country_code = 'MY') AS local_booths,
              COALESCE(SUM(a.sqm) FILTER (WHERE a.country_code = 'MY'), 0) AS local_sqm,
              COUNT(*) FILTER (WHERE a.country_code IS DISTINCT FROM 'MY') AS int_booths,
              COALESCE(SUM(a.sqm) FILTER (WHERE a.country_code IS DISTINCT FROM 'MY'), 0) AS int_sqm
       FROM allocated a
       GROUP BY COALESCE(a.item_code, $3)
       ORDER BY sqm DESC`,
      [...params, await getPrimaryBaseCode(req.companyId, event_id)]
    ),
  ]);

  // Descriptions come from the Price List so a company's own renamed/added
  // booth types show through with no code change.
  const plResult = await pool.query(
    `SELECT DISTINCT sales_item_code, description FROM price_list WHERE company_id = $1 AND event_id = $2`,
    [req.companyId, event_id]
  );
  const descByCode = Object.fromEntries(plResult.rows.map((r) => [r.sales_item_code, r.description]));

  const t = totalsR.rows[0];
  const num = (v) => Number(v) || 0;
  res.json({
    totals: {
      totalBooths: num(t.total_booths), totalSqm: num(t.total_sqm),
      allocatedBooths: num(t.allocated_booths), allocatedSqm: num(t.allocated_sqm),
      contractedBooths: num(t.contracted_booths), contractedSqm: num(t.contracted_sqm),
      proposedBooths: num(t.proposed_booths), proposedSqm: num(t.proposed_sqm),
    },
    byCountry: byCountryR.rows.map((r) => ({
      code: r.code, country: r.country, type: r.type,
      booths: num(r.booths), sqm: num(r.sqm),
      contracted_booths: num(r.contracted_booths), contracted_sqm: num(r.contracted_sqm),
    })),
    byType: byTypeR.rows.map((r) => ({
      item_code: r.item_code, description: descByCode[r.item_code] || r.item_code,
      booths: num(r.booths), sqm: num(r.sqm),
      contracted_booths: num(r.contracted_booths), contracted_sqm: num(r.contracted_sqm),
      local_booths: num(r.local_booths), local_sqm: num(r.local_sqm),
      int_booths: num(r.int_booths), int_sqm: num(r.int_sqm),
    })),
  });
}

module.exports = {
  getOverview, getBySalesperson, getByAgent, getByItem, getPipeline, getComparison, getByCountry, getByMonth, getTargets, saveTargets,
  getAgentCommission, getBoothSpace,
};
