const { pool } = require('../config/db');
const { visibilityClause, financeVisibilityClause } = require('../utils/visibility');

// The Excel LIST tab classifies sales items as BOOTH or OTHER — only the
// BOOTH-category codes count toward the "total booths" management KPI.
const BOOTH_TYPE_CODES = ['BAS', 'SSS', 'ESS', 'WOP', 'CUB'];

// Customer Aging / AR report — every unpaid or partially-paid invoice,
// bucketed by days overdue using the company's own aging_buckets (not a
// fixed 30/60/90/120, per the plan's "nothing hardcoded per company" rule).
async function getCustomerAging(req, res) {
  const { event_id } = req.query;
  if (!event_id) {
    return res.status(400).json({ error: 'event_id is required.' });
  }

  // Finance chases every customer's balance company-wide, not just their
  // own salesperson's deals — same reasoning as invoices.controller.js.
  const vis = financeVisibilityClause(req, 'so.salesperson_id', 3);

  const invoicesResult = await pool.query(
    `WITH invoice_balances AS (
       SELECT inv.id, inv.invoice_no, inv.invoice_date, inv.amount_myr,
              inv.expected_payment_date, inv.aging_notes, inv.aging_updated_at,
              ex.company_name AS exhibitor_name,
              COALESCE((SELECT SUM(amount_myr) FROM payment_allocations WHERE invoice_id = inv.id), 0) AS total_paid,
              inv.amount_myr
                - COALESCE((SELECT SUM(amount_myr) FROM payment_allocations WHERE invoice_id = inv.id), 0)
                - COALESCE((SELECT SUM(amount_myr) FROM credit_notes WHERE invoice_id = inv.id AND status = 'CONFIRMED'), 0)
                AS balance_due,
              GREATEST(0, CURRENT_DATE - inv.invoice_date) AS days_overdue
       FROM invoices inv
       JOIN exhibitors ex ON ex.id = inv.exhibitor_id
       JOIN sales_orders so ON so.id = inv.sales_order_id
       WHERE inv.company_id = $1
         AND inv.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
         AND ${vis.sql}
     )
     SELECT ib.*, ab.label AS bucket_label, ab.sort_order AS bucket_sort_order
     FROM invoice_balances ib
     LEFT JOIN aging_buckets ab
       ON ab.company_id = $1
      AND ib.days_overdue >= ab.min_days
      AND (ab.max_days IS NULL OR ib.days_overdue <= ab.max_days)
     WHERE ib.balance_due > 0.01
     ORDER BY ib.days_overdue DESC`,
    [req.companyId, event_id, ...(vis.param !== undefined ? [vis.param] : [])]
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

  const [oppResult, contractedNotInvoicedResult, contractValueResult, invoicedResult, collectedResult, creditedResult, followUpsResult, boothsResult] =
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
      // "Collected for this event" = payments actually allocated to this
      // event's invoices — an unallocated credit isn't tied to any
      // particular event yet, so it doesn't count here until it's applied.
      pool.query(
        `SELECT COALESCE(SUM(pa.amount_myr), 0) AS total
         FROM payment_allocations pa JOIN invoices inv ON inv.id = pa.invoice_id
         WHERE inv.company_id = $1 AND inv.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)`,
        [req.companyId, event_id]
      ),
      // Confirmed credit notes for this event's invoices — reduces
      // outstanding only, never "Invoiced"/contracted revenue figures
      // above, per the Credit Note design (see creditNotes.controller.js).
      pool.query(
        `SELECT COALESCE(SUM(cn.amount_myr), 0) AS total
         FROM credit_notes cn
         WHERE cn.company_id = $1 AND cn.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
           AND cn.status = 'CONFIRMED'`,
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
      // "Total Booths" only counts BOOTH-category items (BAS/SSS/ESS/WOP/CUB
      // per the product catalogue) on Won opportunities — OTHER-category
      // items (Corner, Loading, MEP, Badge, Sponsorship...) aren't booths.
      pool.query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(o.booth_sqm), 0) AS total_sqm
         FROM opportunities o
         JOIN sales_stages st ON st.id = o.stage_id
         WHERE o.company_id = $1 AND o.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
           AND o.is_active = TRUE AND st.is_won AND o.booth_type = ANY($3)`,
        [req.companyId, event_id, BOOTH_TYPE_CODES]
      ),
    ]);

  const opp = oppResult.rows[0];
  const totalInvoiced = Number(invoicedResult.rows[0].total);
  const totalCollected = Number(collectedResult.rows[0].total);
  const totalCredited = Number(creditedResult.rows[0].total);

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
    totalOutstanding: totalInvoiced - totalCollected - totalCredited,
    followUpsDue: Number(followUpsResult.rows[0].count),
    totalBooths: {
      count: Number(boothsResult.rows[0].count),
      totalSqm: Number(boothsResult.rows[0].total_sqm),
    },
  });
}

// Urgency is the same 3-bucket idea everywhere a date drives a to-do:
// overdue = urgent, today = due, within a week = soon. Kept as one helper
// so Dashboard/Opportunities/Contracts read it identically.
function urgencyOf(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d - today) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'urgent';
  if (diffDays === 0) return 'due';
  if (diffDays <= 7) return 'soon';
  return null;
}

// A single "what needs my attention" feed, shared across the Dashboard,
// Opportunities and Contracts screens (each shows the slice relevant to
// it) — one query set instead of three separate bespoke ones, so the
// urgency rules stay consistent everywhere. Scoped to the logged-in user's
// own records unless they're Admin/Management, same as every other list.
async function getTasks(req, res) {
  const { event_id } = req.query;
  if (!event_id) {
    return res.status(400).json({ error: 'event_id is required.' });
  }

  const oppVis = visibilityClause(req, 'o.salesperson_id', 3);
  const soVis = visibilityClause(req, 'so.salesperson_id', 3);
  // Outstanding-balance chasing and draft-invoice confirming are Finance's
  // job company-wide, not scoped to their own deals like the other
  // categories below.
  const financeVis = financeVisibilityClause(req, 'so.salesperson_id', 3);

  const [followUpsResult, approvalsResult, invoicesResult, draftInvoicesResult, recentPaymentsResult] = await Promise.all([
    pool.query(
      `SELECT o.id, ex.company_name AS exhibitor_name, o.next_follow_up_date, o.remarks
       FROM opportunities o
       JOIN exhibitors ex ON ex.id = o.exhibitor_id
       JOIN sales_stages st ON st.id = o.stage_id
       WHERE o.company_id = $1 AND o.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
         AND o.is_active = TRUE AND NOT st.is_won AND NOT st.is_lost
         AND o.next_follow_up_date IS NOT NULL AND o.next_follow_up_date <= CURRENT_DATE + INTERVAL '7 days'
         AND ${oppVis.sql}
       ORDER BY o.next_follow_up_date`,
      [req.companyId, event_id, ...(oppVis.param !== undefined ? [oppVis.param] : [])]
    ),
    pool.query(
      `SELECT so.id, ex.company_name AS exhibitor_name, so.contract_date, so.total_myr, so.currency,
              u.full_name AS salesperson_name
       FROM sales_orders so
       JOIN exhibitors ex ON ex.id = so.exhibitor_id
       LEFT JOIN users u ON u.id = so.salesperson_id
       WHERE so.company_id = $1 AND so.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
         AND so.is_active = TRUE AND so.status = 'PENDING_APPROVAL'
         AND ${soVis.sql}
       ORDER BY so.contract_date NULLS LAST`,
      [req.companyId, event_id, ...(soVis.param !== undefined ? [soVis.param] : [])]
    ),
    pool.query(
      `SELECT inv.id, inv.invoice_no, inv.expected_payment_date,
              ex.company_name AS exhibitor_name,
              inv.amount_myr
                - COALESCE((SELECT SUM(amount_myr) FROM payment_allocations WHERE invoice_id = inv.id), 0)
                - COALESCE((SELECT SUM(amount_myr) FROM credit_notes WHERE invoice_id = inv.id AND status = 'CONFIRMED'), 0)
                AS balance_due
       FROM invoices inv
       JOIN exhibitors ex ON ex.id = inv.exhibitor_id
       JOIN sales_orders so ON so.id = inv.sales_order_id
       WHERE inv.company_id = $1 AND inv.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
         AND inv.status = 'CONFIRMED'
         AND inv.expected_payment_date IS NOT NULL AND inv.expected_payment_date <= CURRENT_DATE + INTERVAL '7 days'
         AND ${financeVis.sql}
       ORDER BY inv.expected_payment_date`,
      [req.companyId, event_id, ...(financeVis.param !== undefined ? [financeVis.param] : [])]
    ),
    // Draft invoices waiting on Finance to review and confirm — the
    // salesperson-drafts-it-then-Finance-confirms-it handoff.
    pool.query(
      `SELECT inv.id, inv.invoice_no, inv.invoice_date, inv.amount_myr, inv.currency,
              ex.company_name AS exhibitor_name
       FROM invoices inv
       JOIN exhibitors ex ON ex.id = inv.exhibitor_id
       JOIN sales_orders so ON so.id = inv.sales_order_id
       WHERE inv.company_id = $1 AND inv.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
         AND inv.status = 'DRAFT'
         AND ${financeVis.sql}
       ORDER BY inv.invoice_date NULLS LAST`,
      [req.companyId, event_id, ...(financeVis.param !== undefined ? [financeVis.param] : [])]
    ),
    // Payments Finance has just recorded on THIS user's own contracts — the
    // notify-the-salesperson-so-they-can-acknowledge-and-print-the-receipt
    // handoff. Always scoped to the logged-in user's own deals (not
    // finance-wide), and excludes unassigned contracts (nobody to notify).
    // One row per allocation, not per payment — a single lump-sum payment
    // can now be split across several invoices, so the salesperson sees
    // their own contract's specific share of it, not the whole receipt.
    // Stays visible with no time limit until acknowledged (see
    // payments.controller.js's acknowledgeAllocation) — it used to just
    // age out after 7 days whether or not anyone had actually seen it.
    pool.query(
      `SELECT pa.id, p.id AS payment_id, p.payment_date, pa.amount_myr, inv.invoice_no, inv.id AS invoice_id,
              ex.company_name AS exhibitor_name
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       JOIN invoices inv ON inv.id = pa.invoice_id
       JOIN sales_orders so ON so.id = inv.sales_order_id
       JOIN exhibitors ex ON ex.id = inv.exhibitor_id
       WHERE inv.company_id = $1 AND inv.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
         AND so.salesperson_id = $3
         AND pa.acknowledged_at IS NULL
       ORDER BY p.payment_date DESC`,
      [req.companyId, event_id, req.userId]
    ),
  ]);

  const opportunityFollowUps = followUpsResult.rows
    .map((r) => ({ ...r, urgency: urgencyOf(r.next_follow_up_date) }))
    .filter((r) => r.urgency);

  const pendingApprovals = approvalsResult.rows.map((r) => ({ ...r, urgency: 'urgent' }));

  const outstandingInvoices = invoicesResult.rows
    .filter((r) => Number(r.balance_due) > 0.01)
    .map((r) => ({ ...r, urgency: urgencyOf(r.expected_payment_date) }))
    .filter((r) => r.urgency);

  const draftInvoices = draftInvoicesResult.rows.map((r) => ({ ...r, urgency: 'urgent' }));

  const recentPayments = recentPaymentsResult.rows.map((r) => ({ ...r, urgency: 'info' }));

  res.json({ opportunityFollowUps, pendingApprovals, outstandingInvoices, draftInvoices, recentPayments });
}

// Statement of Account — one customer's full history: every confirmed
// invoice issued and every payment received, chronologically, with a
// running balance. Also surfaces their unallocated credit (money received
// but not yet applied to a specific invoice) so Finance can see it's
// available to apply. Lives on the Exhibitor screen, not a separate report
// page, per the user's own choice.
async function getStatementOfAccount(req, res) {
  const { exhibitor_id } = req.query;
  if (!exhibitor_id) {
    return res.status(400).json({ error: 'exhibitor_id is required.' });
  }

  const exResult = await pool.query(
    `SELECT id, company_name, contact1_email, contact1_name, billing_email
     FROM exhibitors WHERE id = $1 AND company_id = $2`,
    [exhibitor_id, req.companyId]
  );
  const exhibitor = exResult.rows[0];
  if (!exhibitor) {
    return res.status(404).json({ error: 'Exhibitor not found.' });
  }

  const [invoicesResult, paymentsResult, creditNotesResult, creditResult] = await Promise.all([
    pool.query(
      `SELECT id, invoice_no, invoice_date, amount_myr FROM invoices
       WHERE company_id = $1 AND exhibitor_id = $2 AND status = 'CONFIRMED'
       ORDER BY invoice_date`,
      [req.companyId, exhibitor_id]
    ),
    pool.query(
      `SELECT id, payment_date, amount_myr, receipt_no FROM payments
       WHERE company_id = $1 AND exhibitor_id = $2
       ORDER BY payment_date`,
      [req.companyId, exhibitor_id]
    ),
    pool.query(
      `SELECT id, cn_no, cn_date, amount_myr FROM credit_notes
       WHERE company_id = $1 AND exhibitor_id = $2 AND status = 'CONFIRMED'
       ORDER BY cn_date`,
      [req.companyId, exhibitor_id]
    ),
    pool.query(
      `SELECT COALESCE(SUM(p.amount_myr), 0)
                - COALESCE((SELECT SUM(pa.amount_myr) FROM payment_allocations pa
                            JOIN payments p2 ON p2.id = pa.payment_id
                            WHERE p2.company_id = $1 AND p2.exhibitor_id = $2), 0) AS credit
       FROM payments p WHERE p.company_id = $1 AND p.exhibitor_id = $2`,
      [req.companyId, exhibitor_id]
    ),
  ]);

  const activities = [
    ...invoicesResult.rows.map((r) => ({
      id: r.id, date: r.invoice_date, type: 'INVOICE', label: `Invoice ${r.invoice_no}`,
      debit: Number(r.amount_myr), credit: 0,
    })),
    ...paymentsResult.rows.map((r) => ({
      id: r.id, date: r.payment_date, type: 'PAYMENT', label: r.receipt_no ? `Payment ${r.receipt_no}` : 'Payment',
      debit: 0, credit: Number(r.amount_myr),
    })),
    ...creditNotesResult.rows.map((r) => ({
      id: r.id, date: r.cn_date, type: 'CREDIT_NOTE', label: `Credit Note ${r.cn_no}`,
      debit: 0, credit: Number(r.amount_myr),
    })),
  ].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

  let balance = 0;
  for (const a of activities) {
    balance += a.debit - a.credit;
    a.balance = balance;
  }

  res.json({
    exhibitor,
    activities,
    totalOutstanding: balance,
    creditBalance: Number(creditResult.rows[0].credit),
  });
}

module.exports = { getCustomerAging, getDashboard, getTasks, getStatementOfAccount };
