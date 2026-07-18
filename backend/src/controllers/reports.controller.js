const { pool } = require('../config/db');

// Customer Aging / AR report — every unpaid or partially-paid invoice,
// bucketed by days overdue using the company's own aging_buckets (not a
// fixed 30/60/90/120, per the plan's "nothing hardcoded per company" rule).
async function getCustomerAging(req, res) {
  const { event_id } = req.query;
  if (!event_id) {
    return res.status(400).json({ error: 'event_id is required.' });
  }

  const invoicesResult = await pool.query(
    `WITH invoice_balances AS (
       SELECT inv.id, inv.invoice_no, inv.invoice_date, inv.amount_myr,
              ex.company_name AS exhibitor_name,
              COALESCE((SELECT SUM(amount_myr) FROM payments WHERE invoice_id = inv.id), 0) AS total_paid,
              inv.amount_myr - COALESCE((SELECT SUM(amount_myr) FROM payments WHERE invoice_id = inv.id), 0) AS balance_due,
              GREATEST(0, CURRENT_DATE - inv.invoice_date) AS days_overdue
       FROM invoices inv
       JOIN exhibitors ex ON ex.id = inv.exhibitor_id
       WHERE inv.company_id = $1
         AND inv.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
     )
     SELECT ib.*, ab.label AS bucket_label, ab.sort_order AS bucket_sort_order
     FROM invoice_balances ib
     LEFT JOIN aging_buckets ab
       ON ab.company_id = $1
      AND ib.days_overdue >= ab.min_days
      AND (ab.max_days IS NULL OR ib.days_overdue <= ab.max_days)
     WHERE ib.balance_due > 0.01
     ORDER BY ib.days_overdue DESC`,
    [req.companyId, event_id]
  );

  const bucketsResult = await pool.query(
    `SELECT label, sort_order FROM aging_buckets WHERE company_id = $1 ORDER BY sort_order`,
    [req.companyId]
  );

  const summaryMap = new Map(
    bucketsResult.rows.map((b) => [b.label, { label: b.label, sortOrder: b.sort_order, count: 0, totalBalance: 0 }])
  );

  let totalOutstanding = 0;
  for (const row of invoicesResult.rows) {
    totalOutstanding += Number(row.balance_due);
    const bucket = summaryMap.get(row.bucket_label);
    if (bucket) {
      bucket.count += 1;
      bucket.totalBalance += Number(row.balance_due);
    }
  }

  const summary = Array.from(summaryMap.values()).sort((a, b) => a.sortOrder - b.sortOrder);

  res.json({ invoices: invoicesResult.rows, summary, totalOutstanding });
}

// Sales Dashboard — replaces the Excel DASHBOARD tab, which today is just a
// navigation hub. Pulls together pipeline KPIs (matching the old
// scrSalesDashboard: Total/Active/Won/Lost) with the financial KPIs already
// computed elsewhere in the app (contract value, invoiced, collected,
// outstanding), plus follow-ups due — all for the selected event.
async function getDashboard(req, res) {
  const { event_id } = req.query;
  if (!event_id) {
    return res.status(400).json({ error: 'event_id is required.' });
  }

  const [oppResult, contractedNotInvoicedResult, contractValueResult, invoicedResult, collectedResult, followUpsResult] =
    await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE NOT st.is_won AND NOT st.is_lost) AS active,
           COUNT(*) FILTER (WHERE st.is_won) AS won,
           COUNT(*) FILTER (WHERE st.is_lost) AS lost
         FROM opportunities o
         JOIN sales_stages st ON st.id = o.stage_id
         WHERE o.company_id = $1 AND o.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2) AND o.is_active = TRUE`,
        [req.companyId, event_id]
      ),
      pool.query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(so.total_myr), 0) AS total_value
         FROM sales_orders so
         WHERE so.company_id = $1 AND so.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2) AND so.is_active = TRUE
           AND NOT EXISTS (SELECT 1 FROM invoices inv WHERE inv.sales_order_id = so.id)`,
        [req.companyId, event_id]
      ),
      pool.query(
        `SELECT COALESCE(SUM(total_myr), 0) AS total FROM sales_orders
         WHERE company_id = $1 AND event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2) AND is_active = TRUE`,
        [req.companyId, event_id]
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount_myr), 0) AS total FROM invoices
         WHERE company_id = $1 AND event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)`,
        [req.companyId, event_id]
      ),
      pool.query(
        `SELECT COALESCE(SUM(p.amount_myr), 0) AS total
         FROM payments p JOIN invoices inv ON inv.id = p.invoice_id
         WHERE inv.company_id = $1 AND inv.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)`,
        [req.companyId, event_id]
      ),
      pool.query(
        `SELECT COUNT(*) AS count
         FROM opportunities o JOIN sales_stages st ON st.id = o.stage_id
         WHERE o.company_id = $1 AND o.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2) AND o.is_active = TRUE
           AND NOT st.is_won AND NOT st.is_lost
           AND o.next_follow_up_date IS NOT NULL AND o.next_follow_up_date <= CURRENT_DATE`,
        [req.companyId, event_id]
      ),
    ]);

  const opp = oppResult.rows[0];
  const totalInvoiced = Number(invoicedResult.rows[0].total);
  const totalCollected = Number(collectedResult.rows[0].total);

  res.json({
    opportunities: {
      total: Number(opp.total),
      active: Number(opp.active),
      won: Number(opp.won),
      lost: Number(opp.lost),
      conversionRatePct: Number(opp.won) + Number(opp.lost) > 0
        ? (Number(opp.won) / (Number(opp.won) + Number(opp.lost))) * 100
        : 0,
    },
    contractedNotInvoiced: {
      count: Number(contractedNotInvoicedResult.rows[0].count),
      totalValue: Number(contractedNotInvoicedResult.rows[0].total_value),
    },
    totalContractValue: Number(contractValueResult.rows[0].total),
    totalInvoiced,
    totalCollected,
    totalOutstanding: totalInvoiced - totalCollected,
    followUpsDue: Number(followUpsResult.rows[0].count),
  });
}

module.exports = { getCustomerAging, getDashboard };
