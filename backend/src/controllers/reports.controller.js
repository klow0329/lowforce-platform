const { pool } = require('../config/db');
const { visibilityClause, financeVisibilityClause } = require('../utils/visibility');

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
       SELECT inv.id, inv.sales_order_id, inv.invoice_no, inv.invoice_date, inv.amount_myr,
              COALESCE(inv.due_date, inv.invoice_date) AS due_date,
              inv.expected_payment_date, inv.aging_notes, inv.aging_updated_at,
              ex.company_name AS exhibitor_name, ex.billing_name,
              u.full_name AS salesperson_name, ag.name AS agent_name,
              -- Latest correspondence log entry — see correspondence.controller.js;
              -- the list here only ever needs the most recent one, the full
              -- history lives on the Invoice detail page.
              (SELECT c.note FROM correspondence_entries c
               WHERE c.entity_type = 'invoice' AND c.entity_id = inv.id
               ORDER BY c.created_at DESC LIMIT 1) AS latest_correspondence,
              (SELECT c.created_at FROM correspondence_entries c
               WHERE c.entity_type = 'invoice' AND c.entity_id = inv.id
               ORDER BY c.created_at DESC LIMIT 1) AS latest_correspondence_at,
              COALESCE((SELECT SUM(amount_myr) FROM payment_allocations WHERE invoice_id = inv.id), 0) AS total_paid,
              inv.amount_myr
                - COALESCE((SELECT SUM(amount_myr) FROM payment_allocations WHERE invoice_id = inv.id), 0)
                - COALESCE((SELECT SUM(amount_myr) FROM credit_notes WHERE invoice_id = inv.id AND status = 'CONFIRMED'), 0)
                AS balance_due,
              -- Bucketed by the invoice's own due date (its Credit Term
              -- installment date when it has one, else its issue date —
              -- "due on receipt") rather than a flat age from invoice_date,
              -- so a milestone that isn't due yet doesn't read as overdue
              -- just because it was issued a while ago.
              GREATEST(0, CURRENT_DATE - COALESCE(inv.due_date, inv.invoice_date)) AS days_overdue
       FROM invoices inv
       JOIN exhibitors ex ON ex.id = inv.exhibitor_id
       JOIN sales_orders so ON so.id = inv.sales_order_id
       LEFT JOIN users u ON u.id = so.salesperson_id
       LEFT JOIN agents ag ON ag.id = ex.agent_id
       WHERE inv.company_id = $1
         AND inv.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
         AND inv.status = 'CONFIRMED'
         AND inv.is_active = TRUE
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

// Customer Aging by Contract — the same balances as getCustomerAging above,
// but rolled up to one row per Contract instead of one row per Invoice, per
// the user's explicit request (2026-07-31): Sales/Finance often think in
// terms of "what does this contract still owe" rather than chasing
// individual milestone invoices one at a time. Deliberately kept alongside
// (not replacing) the invoice-level report — that one stays the tool for
// per-invoice detail and correspondence follow-up; this one is a
// contract-level summary that drills down into it (see sales_order_id on
// each invoice row above, used by the frontend to filter that report to a
// single contract on click).
//
// due_amount only counts invoiced milestones whose own due_date has already
// passed. The remainder of the contract's balance splits into two visibly
// distinct pieces — per the user's own follow-up correction (2026-07-31):
// lumping them together made an approved contract with ZERO invoices ever
// generated look identical to one that's fully invoiced and genuinely not
// due yet, both showing RM0 due / 0 days overdue. not_invoiced_amount is
// the portion with no invoice row at all yet (any status — DRAFT/SCHEDULED/
// CONFIRMED all count as "invoiced" for this purpose, since a draft still
// means Sales has at least billed for it); not_due_yet is now only the
// remaining invoiced-but-not-yet-due portion. balance_total_due still
// equals total contracted value − collected, matching the Total Outstanding
// formula fixed in the Dashboard/Management KPI work.
async function getCustomerAgingByContract(req, res) {
  const { event_id } = req.query;
  if (!event_id) {
    return res.status(400).json({ error: 'event_id is required.' });
  }

  const vis = financeVisibilityClause(req, 'so.salesperson_id', 3);

  const result = await pool.query(
    `WITH invoice_calc AS (
       SELECT inv.id, inv.sales_order_id, inv.amount_myr,
              COALESCE(inv.due_date, inv.invoice_date) AS due_date,
              inv.expected_payment_date,
              inv.amount_myr
                - COALESCE((SELECT SUM(amount_myr) FROM payment_allocations WHERE invoice_id = inv.id), 0)
                - COALESCE((SELECT SUM(amount_myr) FROM credit_notes WHERE invoice_id = inv.id AND status = 'CONFIRMED'), 0)
                AS balance_due,
              COALESCE((SELECT SUM(amount_myr) FROM payment_allocations WHERE invoice_id = inv.id), 0) AS paid
       FROM invoices inv
       WHERE inv.company_id = $1 AND inv.status = 'CONFIRMED' AND inv.is_active = TRUE
     ),
     contract_agg AS (
       SELECT sales_order_id,
              SUM(paid) AS collected,
              SUM(balance_due) FILTER (WHERE due_date <= CURRENT_DATE AND balance_due > 0.01) AS due_amount,
              MAX(GREATEST(0, CURRENT_DATE - due_date)) FILTER (WHERE balance_due > 0.01) AS days_overdue,
              MIN(COALESCE(expected_payment_date, due_date)) FILTER (WHERE balance_due > 0.01) AS expected_payment
       FROM invoice_calc
       GROUP BY sales_order_id
     ),
     invoiced_agg AS (
       -- Every invoice row regardless of status (DRAFT/SCHEDULED/CONFIRMED)
       -- counts as "invoiced" here — this is purely "has Sales issued
       -- something for this yet", distinct from contract_agg's CONFIRMED-
       -- only balances above. Archived (is_active = FALSE) invoices don't
       -- count — same as everywhere else archiving is honored.
       SELECT sales_order_id, SUM(amount_myr) AS invoiced_total
       FROM invoices
       WHERE company_id = $1 AND is_active = TRUE
       GROUP BY sales_order_id
     )
     SELECT so.id, so.contract_date, so.total_myr AS total_contracted_value,
            ex.company_name AS exhibitor_name, ex.billing_name,
            u.full_name AS salesperson_name, ag.name AS agent_name,
            COALESCE(ca.collected, 0) AS collected_value,
            (so.total_myr - COALESCE(ca.collected, 0)) AS balance_total_due,
            -- Capped at the contract's own current balance — a Contract
            -- Reduction recomputes so.total_myr the moment it's approved,
            -- but the shortfall Credit Note against an already-CONFIRMED
            -- invoice isn't auto-created (Sales issues it afterward, and it
            -- only actually reduces that invoice's balance once Finance
            -- confirms it) — so due_amount could otherwise still reflect
            -- the invoice's PRE-reduction balance and read as "more overdue
            -- than the contract is even worth" in the gap before that CN is
            -- confirmed (2026-08-01 audit finding).
            LEAST(COALESCE(ca.due_amount, 0), GREATEST(0, so.total_myr - COALESCE(ca.collected, 0))) AS due_amount,
            GREATEST(0, so.total_myr - COALESCE(ia.invoiced_total, 0)) AS not_invoiced_amount,
            GREATEST(0,
              (so.total_myr - COALESCE(ca.collected, 0))
              - LEAST(COALESCE(ca.due_amount, 0), GREATEST(0, so.total_myr - COALESCE(ca.collected, 0)))
              - GREATEST(0, so.total_myr - COALESCE(ia.invoiced_total, 0))
            ) AS not_due_yet,
            COALESCE(ca.days_overdue, 0) AS days_overdue,
            ca.expected_payment
     FROM sales_orders so
     JOIN exhibitors ex ON ex.id = so.exhibitor_id
     LEFT JOIN users u ON u.id = so.salesperson_id
     LEFT JOIN agents ag ON ag.id = ex.agent_id
     LEFT JOIN contract_agg ca ON ca.sales_order_id = so.id
     LEFT JOIN invoiced_agg ia ON ia.sales_order_id = so.id
     WHERE so.company_id = $1
       AND so.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
       AND so.status = 'APPROVED'
       AND so.is_active = TRUE
       AND ${vis.sql}
       AND (so.total_myr - COALESCE(ca.collected, 0)) > 0.01
     ORDER BY days_overdue DESC`,
    [req.companyId, event_id, ...(vis.param !== undefined ? [vis.param] : [])]
  );

  const totalOutstanding = result.rows.reduce((sum, r) => sum + Number(r.balance_total_due), 0);

  res.json({ contracts: result.rows, totalOutstanding });
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

  const [oppResult, contractedNotInvoicedResult, contractValueResult, invoicedResult, collectedResult, followUpsResult, boothsResult] =
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
      // "Contracted, Not Yet Invoiced" — same APPROVED-only meaning as
      // Total Contracted Value right below (a Draft/Pending/Void contract
      // trivially has no invoice yet without being a real un-invoiced
      // obligation) — this was missing the status filter that query has
      // always had (2026-08-01 audit finding).
      pool.query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(so.total_myr), 0) AS total_value
         FROM sales_orders so
         WHERE so.company_id = $1 AND so.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
           AND so.is_active = TRUE AND so.status = 'APPROVED'
           AND NOT EXISTS (SELECT 1 FROM invoices inv WHERE inv.sales_order_id = so.id AND inv.is_active = TRUE)`,
        [req.companyId, event_id]
      ),
      // "Total Contracted Value" — approved contracts only (not
      // Draft/Pending Approval/Void), so it means what it says: value the
      // company has actually contracted, not everything sitting in the
      // pipeline. total_myr is already net of any approved Credit Note
      // reduction (CN v3 mutates the contract's own total on approval — see
      // creditNotes.controller.js), so this figure needs no separate CN
      // subtraction to be the true current contracted value.
      pool.query(
        `SELECT COALESCE(SUM(total_myr), 0) AS total FROM sales_orders
         WHERE company_id = $1 AND event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
           AND is_active = TRUE AND status = 'APPROVED'`,
        [req.companyId, event_id]
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount_myr), 0) AS total FROM invoices
         WHERE company_id = $1 AND event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
           AND status = 'CONFIRMED'`,
        [req.companyId, event_id]
      ),
      // "Collected for this event" = payments actually allocated to this
      // event's invoices — an unallocated credit isn't tied to any
      // particular event yet, so it doesn't count here until it's applied.
      pool.query(
        `SELECT COALESCE(SUM(pa.amount_myr), 0) AS total
         FROM payment_allocations pa JOIN invoices inv ON inv.id = pa.invoice_id
         WHERE inv.company_id = $1 AND inv.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
           AND inv.status = 'CONFIRMED'`,
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
      // "Total Booths" counts physical booths on approved contracts —
      // sourced from sales_orders directly, the SAME base table Overview's
      // Total Sqm and By Item & Type both use, so this tile is guaranteed to
      // reconcile with them by construction. Deriving it from
      // opportunities.booth_type instead (the old approach) was a straight
      // count/sqm mismatch: that field is a stale single-value leftover from
      // before multi-booth support (never populated by the booth-selection-
      // first flow), and "Won" opportunities aren't 1:1 with approved
      // contracts (a company can have Won opportunities with no contract at
      // all, e.g. historical bulk-imported rows) — verified live this was
      // both dropping real contracts entirely for events where booth_type
      // was never set, AND overcounting for events where stale Won
      // opportunities outnumbered their actual approved contracts. Every
      // approved contract either sums its own linked physical booths (one
      // row per booth, real sqm each) or, if it predates Floor Plan linkage
      // entirely, counts as one booth at its own total_sqm — the same
      // legacy convention getByItem already uses.
      pool.query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(sqm), 0) AS total_sqm FROM (
           SELECT fpb.sqm AS sqm
           FROM floor_plan_booths fpb
           JOIN sales_orders so ON so.id = fpb.sales_order_id
           WHERE so.company_id = $1 AND so.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
             AND so.status = 'APPROVED' AND so.is_active = TRUE

           UNION ALL

           SELECT so.total_sqm AS sqm
           FROM sales_orders so
           WHERE so.company_id = $1 AND so.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
             AND so.status = 'APPROVED' AND so.is_active = TRUE
             AND NOT EXISTS (SELECT 1 FROM floor_plan_booths fpb2 WHERE fpb2.sales_order_id = so.id)
         ) sub`,
        [req.companyId, event_id]
      ),
    ]);

  const opp = oppResult.rows[0];
  const totalInvoiced = Number(invoicedResult.rows[0].total);
  const totalCollected = Number(collectedResult.rows[0].total);
  const totalContractValue = Number(contractValueResult.rows[0].total);

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
    totalContractValue,
    totalInvoiced,
    totalCollected,
    // Total Contracted Value - Total Collected — covers the full approved
    // obligation, including anything contracted but not yet invoiced (or
    // invoiced but not yet due), not just invoiced-minus-collected. This
    // needs no separate Credit Note subtraction: totalContractValue already
    // nets out any approved CN reduction (see the query above).
    totalOutstanding: totalContractValue - totalCollected,
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
  // Acting as Finance, the Task To-Do is narrowed to just the two things
  // that are actually Finance's job (confirm invoice / confirm CN) — every
  // other category here is scoped by the user's own salesperson_id, which
  // still matches for someone whose account also happens to be a
  // salesperson on real deals (common on a small team), so without this
  // they'd keep seeing Sales/Management items while acting as Finance.
  const financeOnly = req.roleCode === 'FIN';
  const skip = Promise.resolve({ rows: [] });

  const [
    followUpsResult, approvalsResult, invoicesResult, draftInvoicesResult, recentPaymentsResult, recentConfirmedInvoicesResult, scheduledMilestonesResult,
    pendingCnApprovalsResult, draftCnsResult, recentConfirmedCnsResult, recentApprovedContractsResult, lostBoothClaimsResult, paymentProofAttachmentsResult,
    pendingReductionApprovalsResult, recentResolvedReductionsResult,
  ] = await Promise.all([
    financeOnly ? skip : pool.query(
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
    financeOnly ? skip : pool.query(
      `SELECT so.id, ex.company_name AS exhibitor_name, so.contract_date, so.total_myr, so.currency,
              u.full_name AS salesperson_name,
              -- contract_date is when the deal was originally booked, not
              -- when THIS approval cycle started — the most recent
              -- SUBMITTED/FLAGGED approval_log entry is the real "when did
              -- this land in the queue" timestamp (a FLAGGED entry covers
              -- the auto-resubmit case, e.g. an edit after approval).
              (SELECT MAX(al.created_at) FROM approval_log al
               WHERE al.sales_order_id = so.id AND al.action IN ('SUBMITTED', 'FLAGGED')) AS submitted_at,
              (SELECT al.notes FROM approval_log al
               WHERE al.sales_order_id = so.id AND al.action IN ('SUBMITTED', 'FLAGGED')
               ORDER BY al.created_at DESC LIMIT 1) AS submit_reason
       FROM sales_orders so
       JOIN exhibitors ex ON ex.id = so.exhibitor_id
       LEFT JOIN users u ON u.id = so.salesperson_id
       WHERE so.company_id = $1 AND so.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
         AND so.is_active = TRUE AND so.status IN ('PENDING_APPROVAL', 'PENDING_APPROVAL_STEP2')
         AND ${soVis.sql}
       ORDER BY so.contract_date NULLS LAST`,
      [req.companyId, event_id, ...(soVis.param !== undefined ? [soVis.param] : [])]
    ),
    financeOnly ? skip : pool.query(
      `SELECT inv.id, inv.invoice_no, inv.expected_payment_date,
              ex.company_name AS exhibitor_name,
              inv.amount_myr
                - COALESCE((SELECT SUM(pa.amount_myr) FROM payment_allocations pa
                            JOIN payments p ON p.id = pa.payment_id
                            WHERE pa.invoice_id = inv.id AND p.is_active = TRUE), 0)
                - COALESCE((SELECT SUM(amount_myr) FROM credit_notes WHERE invoice_id = inv.id AND status = 'CONFIRMED' AND is_active = TRUE), 0)
                AS balance_due
       FROM invoices inv
       JOIN exhibitors ex ON ex.id = inv.exhibitor_id
       JOIN sales_orders so ON so.id = inv.sales_order_id
       WHERE inv.company_id = $1 AND inv.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
         AND inv.status = 'CONFIRMED' AND inv.is_active = TRUE
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
    financeOnly ? skip : pool.query(
      `SELECT pa.id, p.id AS payment_id, p.payment_date, pa.amount_myr, inv.invoice_no, inv.id AS invoice_id,
              ex.company_name AS exhibitor_name
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       JOIN invoices inv ON inv.id = pa.invoice_id
       JOIN sales_orders so ON so.id = inv.sales_order_id
       JOIN exhibitors ex ON ex.id = inv.exhibitor_id
       WHERE inv.company_id = $1 AND inv.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
         AND COALESCE(so.salesperson_id, ex.salesperson_id) = $3
         AND pa.acknowledged_at IS NULL
       ORDER BY p.payment_date DESC`,
      [req.companyId, event_id, req.userId]
    ),
    // Invoices Finance has just confirmed on THIS user's own contracts —
    // mirrors recentPayments above (see invoices.controller.js's
    // acknowledgeConfirm). Sales cross-checked the billing detail when
    // drafting it; this is the "yes, Finance signed off on it" handoff back.
    financeOnly ? skip : pool.query(
      `SELECT inv.id, inv.invoice_no, inv.amount_myr, inv.currency, inv.amount_foreign,
              ex.company_name AS exhibitor_name
       FROM invoices inv
       JOIN sales_orders so ON so.id = inv.sales_order_id
       JOIN exhibitors ex ON ex.id = inv.exhibitor_id
       WHERE inv.company_id = $1 AND inv.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
         AND COALESCE(so.salesperson_id, ex.salesperson_id) = $3
         AND inv.status = 'CONFIRMED'
         AND inv.confirm_acknowledged_at IS NULL
       ORDER BY inv.invoice_date DESC`,
      [req.companyId, event_id, req.userId]
    ),
    // Milestone billings planned but not yet issued (see
    // invoices.controller.js's SCHEDULED status) — "coming soon" once
    // within 7 days of their target date, but always listed regardless so
    // Sales can issue one early if the customer's ready sooner.
    financeOnly ? skip : pool.query(
      `SELECT inv.id, inv.sales_order_id, inv.amount_foreign, inv.currency, inv.expected_billing_date, inv.billing_pct,
              ex.company_name AS exhibitor_name
       FROM invoices inv
       JOIN exhibitors ex ON ex.id = inv.exhibitor_id
       JOIN sales_orders so ON so.id = inv.sales_order_id
       WHERE inv.company_id = $1 AND inv.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
         AND inv.status = 'SCHEDULED'
         AND ${soVis.sql}
       ORDER BY inv.expected_billing_date`,
      [req.companyId, event_id, ...(soVis.param !== undefined ? [soVis.param] : [])]
    ),
    // Credit notes pending your approval — mirrors pendingApprovals above,
    // same simplification (a real tiered-matrix approver check happens
    // server-side on the actual approve/reject action; this list just needs
    // to reach elevated roles broadly so nobody misses a request).
    financeOnly ? skip : pool.query(
      `SELECT cn.id, ex.company_name AS exhibitor_name, cn.amount_myr, cn.created_at
       FROM credit_notes cn
       JOIN exhibitors ex ON ex.id = cn.exhibitor_id
       JOIN sales_orders so ON so.id = cn.sales_order_id
       WHERE cn.company_id = $1 AND cn.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
         AND cn.status = 'PENDING_APPROVAL' AND ${soVis.sql}
       ORDER BY cn.created_at`,
      [req.companyId, event_id, ...(soVis.param !== undefined ? [soVis.param] : [])]
    ),
    // Credit notes approved and numbered, waiting on Finance to confirm —
    // mirrors draftInvoices above.
    pool.query(
      `SELECT cn.id, cn.cn_no, cn.amount_myr, cn.approved_at, ex.company_name AS exhibitor_name
       FROM credit_notes cn
       JOIN exhibitors ex ON ex.id = cn.exhibitor_id
       JOIN sales_orders so ON so.id = cn.sales_order_id
       WHERE cn.company_id = $1 AND cn.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
         AND cn.status = 'DRAFT' AND ${financeVis.sql}
       ORDER BY cn.approved_at NULLS LAST`,
      [req.companyId, event_id, ...(financeVis.param !== undefined ? [financeVis.param] : [])]
    ),
    // Credit notes Finance has just confirmed on THIS user's own contracts
    // — mirrors recentConfirmedInvoices above.
    financeOnly ? skip : pool.query(
      `SELECT cn.id, cn.cn_no, cn.amount_myr, ex.company_name AS exhibitor_name
       FROM credit_notes cn
       JOIN sales_orders so ON so.id = cn.sales_order_id
       JOIN exhibitors ex ON ex.id = cn.exhibitor_id
       WHERE cn.company_id = $1 AND cn.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
         AND COALESCE(so.salesperson_id, ex.salesperson_id) = $3
         AND cn.status = 'CONFIRMED'
         AND cn.confirm_acknowledged_at IS NULL
       ORDER BY cn.confirmed_at DESC`,
      [req.companyId, event_id, req.userId]
    ),
    // Contracts Management has just approved (or sent back to Draft via
    // reject) on THIS user's own deals — mirrors recentConfirmedInvoices;
    // this was a genuine gap (contract approval never notified Sales at
    // all until this was added).
    financeOnly ? skip : pool.query(
      `SELECT so.id, so.status, so.total_myr, ex.company_name AS exhibitor_name,
              -- What this specific approval/rejection cycle was actually
              -- about (booth change, discount, revenue threshold, new
              -- contract...) — same reasoning as the pendingApprovals query
              -- above, so the notification isn't just a bare status change.
              (SELECT al.notes FROM approval_log al
               WHERE al.sales_order_id = so.id AND al.action IN ('SUBMITTED', 'FLAGGED')
               ORDER BY al.created_at DESC LIMIT 1) AS change_reason,
              (SELECT al.notes FROM approval_log al
               WHERE al.sales_order_id = so.id AND al.action = 'REJECTED'
               ORDER BY al.created_at DESC LIMIT 1) AS reject_reason
       FROM sales_orders so
       JOIN exhibitors ex ON ex.id = so.exhibitor_id
       WHERE so.company_id = $1 AND so.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
         AND COALESCE(so.salesperson_id, ex.salesperson_id) = $3
         AND (so.status = 'APPROVED' OR (so.status = 'DRAFT' AND so.rejected_at IS NOT NULL))
         AND so.approval_acknowledged_at IS NULL
         AND so.is_active = TRUE
       ORDER BY so.contract_date DESC NULLS LAST`,
      [req.companyId, event_id, req.userId]
    ),
    // Booths this user's own Opportunities/draft Contracts were still
    // proposing when a COMPETING contract for the same booth got approved
    // first (competing-claims rule, Round 6 item 4) — grouped one row per
    // losing record, since it may have lost more than one booth at once.
    financeOnly ? skip : pool.query(
      `SELECT record_type, record_id, exhibitor_name, salesperson_id,
              STRING_AGG(booth_no, ', ' ORDER BY booth_no) AS lost_booth_nos, MAX(released_at) AS released_at
       FROM (
         SELECT c.record_type, c.record_id, ex.company_name AS exhibitor_name, opp.salesperson_id, b.booth_no, c.released_at
         FROM floor_plan_booth_claims c
         JOIN floor_plan_booths b ON b.id = c.booth_id
         JOIN floor_plan_halls h ON h.id = b.hall_id
         JOIN opportunities opp ON opp.id = c.record_id
         JOIN exhibitors ex ON ex.id = opp.exhibitor_id
         WHERE c.record_type = 'opportunity' AND c.release_reason = 'LOST_TO_APPROVAL' AND c.acknowledged_at IS NULL
           AND h.company_id = $1 AND opp.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2) AND opp.salesperson_id = $3
           AND opp.is_active = TRUE
         UNION ALL
         SELECT c.record_type, c.record_id, ex.company_name AS exhibitor_name, so.salesperson_id, b.booth_no, c.released_at
         FROM floor_plan_booth_claims c
         JOIN floor_plan_booths b ON b.id = c.booth_id
         JOIN floor_plan_halls h ON h.id = b.hall_id
         JOIN sales_orders so ON so.id = c.record_id
         JOIN exhibitors ex ON ex.id = so.exhibitor_id
         WHERE c.record_type = 'sales_order' AND c.release_reason = 'LOST_TO_APPROVAL' AND c.acknowledged_at IS NULL
           AND h.company_id = $1 AND so.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2) AND so.salesperson_id = $3
           AND so.is_active = TRUE
       ) x
       GROUP BY record_type, record_id, exhibitor_name, salesperson_id
       ORDER BY MAX(released_at) DESC`,
      [req.companyId, event_id, req.userId]
    ),
    // A customer's proof of payment was attached to an invoice — Finance-
    // only (only surfaced while actively acting as Finance, unlike the
    // other categories above which stay visible to Sales too), since
    // acknowledging it is Finance's action alone (see
    // invoiceAttachments.controller.js's acknowledgePaymentProof).
    financeOnly ? pool.query(
      `SELECT a.id AS attachment_id, inv.id, inv.invoice_no, ex.company_name AS exhibitor_name,
              a.original_filename, a.uploaded_at
       FROM invoice_attachments a
       JOIN invoices inv ON inv.id = a.invoice_id
       JOIN sales_orders so ON so.id = inv.sales_order_id
       JOIN exhibitors ex ON ex.id = inv.exhibitor_id
       WHERE inv.company_id = $1 AND inv.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
         AND a.doc_type = 'PAYMENT_PROOF' AND a.finance_acknowledged_at IS NULL
         AND ${financeVis.sql}
       ORDER BY a.uploaded_at`,
      [req.companyId, event_id, ...(financeVis.param !== undefined ? [financeVis.param] : [])]
    ) : skip,
    // Contract Reductions pending your approval — mirrors
    // pendingCnApprovalsResult above. This was a genuine gap: the request
    // deliberately leaves sales_orders.status alone while pending (same as
    // Credit Notes), so it never showed up in the plain
    // sales_orders-status-based approvalsResult query above.
    financeOnly ? skip : pool.query(
      `SELECT cr.id, cr.sales_order_id, ex.company_name AS exhibitor_name,
              cr.old_total_foreign, cr.new_total_foreign, cr.cn_amount_myr, cr.created_at, so.currency
       FROM contract_reductions cr
       JOIN exhibitors ex ON ex.id = cr.exhibitor_id
       JOIN sales_orders so ON so.id = cr.sales_order_id
       WHERE cr.company_id = $1 AND cr.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
         AND cr.status = 'PENDING_APPROVAL' AND ${soVis.sql}
       ORDER BY cr.created_at`,
      [req.companyId, event_id, ...(soVis.param !== undefined ? [soVis.param] : [])]
    ),
    // Value Change requests Management has just approved or rejected on
    // THIS user's own deals — mirrors recentApprovedContracts above. A
    // genuine gap before this: the request deliberately leaves
    // sales_orders.status untouched while resolving (same reasoning as the
    // pending-approval query above), so it could never trigger that query's
    // so.status-based notification either (2026-08-01 user request: full
    // notification chain for the Value Change flow).
    financeOnly ? skip : pool.query(
      `SELECT cr.id, cr.sales_order_id, cr.status, cr.old_total_foreign, cr.new_total_foreign, so.currency,
              ex.company_name AS exhibitor_name, cr.rejection_notes
       FROM contract_reductions cr
       JOIN exhibitors ex ON ex.id = cr.exhibitor_id
       JOIN sales_orders so ON so.id = cr.sales_order_id
       WHERE cr.company_id = $1 AND cr.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
         AND cr.status IN ('APPROVED', 'REJECTED')
         AND COALESCE(so.salesperson_id, ex.salesperson_id) = $3
         AND cr.approval_acknowledged_at IS NULL
       ORDER BY cr.created_at DESC`,
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
  const recentConfirmedInvoices = recentConfirmedInvoicesResult.rows.map((r) => ({ ...r, urgency: 'info' }));
  const scheduledMilestones = scheduledMilestonesResult.rows.map((r) => ({ ...r, urgency: urgencyOf(r.expected_billing_date) || 'info' }));

  const pendingCnApprovals = pendingCnApprovalsResult.rows.map((r) => ({ ...r, urgency: 'urgent' }));
  const draftCns = draftCnsResult.rows.map((r) => ({ ...r, urgency: 'urgent' }));
  const recentConfirmedCns = recentConfirmedCnsResult.rows.map((r) => ({ ...r, urgency: 'info' }));
  const recentApprovedContracts = recentApprovedContractsResult.rows.map((r) => ({ ...r, urgency: 'info' }));
  const lostBoothClaims = lostBoothClaimsResult.rows.map((r) => ({ ...r, urgency: 'urgent' }));
  const paymentProofAttachments = paymentProofAttachmentsResult.rows.map((r) => ({ ...r, urgency: 'urgent' }));
  const pendingReductionApprovals = pendingReductionApprovalsResult.rows.map((r) => ({ ...r, urgency: 'urgent' }));
  const recentResolvedReductions = recentResolvedReductionsResult.rows.map((r) => ({ ...r, urgency: 'info' }));

  res.json({
    opportunityFollowUps, pendingApprovals, outstandingInvoices, draftInvoices, recentPayments, recentConfirmedInvoices, scheduledMilestones,
    pendingCnApprovals, draftCns, recentConfirmedCns, recentApprovedContracts, lostBoothClaims, paymentProofAttachments,
    pendingReductionApprovals, recentResolvedReductions,
  });
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
       WHERE company_id = $1 AND exhibitor_id = $2 AND status = 'CONFIRMED' AND is_active = TRUE
       ORDER BY invoice_date`,
      [req.companyId, exhibitor_id]
    ),
    pool.query(
      `SELECT id, payment_date, amount_myr, receipt_no FROM payments
       WHERE company_id = $1 AND exhibitor_id = $2 AND is_active = TRUE
       ORDER BY payment_date`,
      [req.companyId, exhibitor_id]
    ),
    pool.query(
      `SELECT id, cn_no, cn_date, amount_myr FROM credit_notes
       WHERE company_id = $1 AND exhibitor_id = $2 AND status = 'CONFIRMED' AND is_active = TRUE
       ORDER BY cn_date`,
      [req.companyId, exhibitor_id]
    ),
    pool.query(
      `SELECT COALESCE(SUM(p.amount_myr), 0)
                - COALESCE((SELECT SUM(pa.amount_myr) FROM payment_allocations pa
                            JOIN payments p2 ON p2.id = pa.payment_id
                            WHERE p2.company_id = $1 AND p2.exhibitor_id = $2 AND p2.is_active = TRUE), 0) AS credit
       FROM payments p WHERE p.company_id = $1 AND p.exhibitor_id = $2 AND p.is_active = TRUE`,
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

module.exports = { getCustomerAging, getCustomerAgingByContract, getDashboard, getTasks, getStatementOfAccount };
