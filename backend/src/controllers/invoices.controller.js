const { pool } = require('../config/db');
const { financeVisibilityClause } = require('../utils/visibility');

async function listInvoices(req, res) {
  const { event_id, sales_order_id, exhibitor_id, search } = req.query;
  if (!event_id && !sales_order_id && !exhibitor_id) {
    return res.status(400).json({ error: 'event_id, sales_order_id or exhibitor_id is required.' });
  }

  // invoices has no salesperson_id of its own — visibility rides on the
  // contract's salesperson via sales_orders. Finance sees every invoice
  // company-wide (that's the job — confirming and chasing any customer's
  // balance regardless of which salesperson owns the deal), not just their
  // own, hence financeVisibilityClause rather than the general one.
  const vis = financeVisibilityClause(req, 'so.salesperson_id', 6);

  const result = await pool.query(
    `SELECT inv.id, inv.invoice_no, inv.invoice_date, inv.amount_myr, inv.sales_order_id, inv.exhibitor_id,
            inv.currency, inv.amount_foreign, inv.exchange_rate, inv.status, inv.billing_pct,
            ex.company_name AS exhibitor_name,
            inv.amount_myr
              - COALESCE((SELECT SUM(amount_myr) FROM payment_allocations WHERE invoice_id = inv.id), 0)
              - COALESCE((SELECT SUM(amount_myr) FROM credit_notes WHERE invoice_id = inv.id AND status = 'CONFIRMED'), 0)
              AS balance_due,
            -- Same calc in the invoice's own doc currency — CNs are still
            -- MYR-only (see credit_notes.amount_myr) so their share is
            -- approximated via this invoice's own confirmed rate, same
            -- level of FX precision as everywhere else CN interacts with a
            -- foreign-currency invoice.
            inv.amount_foreign
              - COALESCE((SELECT SUM(amount_foreign) FROM payment_allocations WHERE invoice_id = inv.id), 0)
              - COALESCE((SELECT SUM(amount_myr) FROM credit_notes WHERE invoice_id = inv.id AND status = 'CONFIRMED'), 0) / NULLIF(inv.exchange_rate, 0)
              AS balance_due_foreign
     FROM invoices inv
     JOIN exhibitors ex ON ex.id = inv.exhibitor_id
     JOIN sales_orders so ON so.id = inv.sales_order_id
     WHERE inv.company_id = $1
       AND ($2::uuid IS NULL OR inv.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2))
       AND ($3::uuid IS NULL OR inv.sales_order_id = $3)
       AND ($4 = '' OR ex.company_name ILIKE '%' || $4 || '%')
       AND ($5::uuid IS NULL OR inv.exhibitor_id = $5)
       -- A SCHEDULED milestone isn't a real invoice yet (no invoice_no, no
       -- balance due) — it only makes sense to show inline on its own
       -- contract's own Invoices table, never on the company-wide list or
       -- an exhibitor's payment-allocation screen.
       AND (inv.status != 'SCHEDULED' OR $3::uuid IS NOT NULL)
       AND inv.is_active = TRUE
       AND ${vis.sql}
     ORDER BY inv.invoice_date DESC NULLS LAST, inv.invoice_no DESC`,
    [req.companyId, event_id || null, sales_order_id || null, search || '', exhibitor_id || null, ...(vis.param !== undefined ? [vis.param] : [])]
  );

  res.json({ invoices: result.rows });
}

async function getInvoice(req, res) {
  const vis = financeVisibilityClause(req, 'so.salesperson_id', 3);
  const result = await pool.query(
    `SELECT inv.*,
            ex.company_name, ex.country_code, ex.contact1_name, ex.contact1_email, ex.contact1_phone,
            ex.postcode, ex.city, ex.reg_no, ex.tin_no, ex.sst_no,
            ex.billing_name, ex.billing_address, ex.billing_postcode, ex.billing_city,
            ex.billing_country_code, ex.billing_reg_no, ex.billing_tin_no, ex.billing_sst_no,
            ex.billing_contact_no, ex.billing_email, ex.billing_same_as_company,
            ag.name AS agent_name,
            ev.name AS event_name, ev.start_date AS event_start_date, ev.end_date AS event_end_date,
            so.contract_type, so.contract_date, so.hall, so.booth_no, so.total_foreign AS contract_total_foreign,
            so.total_sqm, o.booth_type,
            COALESCE((SELECT SUM(amount_myr) FROM payment_allocations WHERE invoice_id = inv.id), 0) AS total_paid,
            COALESCE((SELECT SUM(amount_myr) FROM credit_notes WHERE invoice_id = inv.id AND status = 'CONFIRMED'), 0) AS total_credited,
            COALESCE((SELECT SUM(amount_foreign) FROM payment_allocations WHERE invoice_id = inv.id), 0) AS total_paid_foreign
     FROM invoices inv
     JOIN exhibitors ex ON ex.id = inv.exhibitor_id
     JOIN events ev ON ev.id = inv.event_id
     JOIN sales_orders so ON so.id = inv.sales_order_id
     LEFT JOIN opportunities o ON o.id = so.opportunity_id
     LEFT JOIN agents ag ON ag.id = ex.agent_id
     WHERE inv.id = $1 AND inv.company_id = $2 AND ${vis.sql}`,
    [req.params.id, req.companyId, ...(vis.param !== undefined ? [vis.param] : [])]
  );

  const invoice = result.rows[0];
  if (!invoice) {
    return res.status(404).json({ error: 'Invoice not found.' });
  }

  invoice.balance_due = Number(invoice.amount_myr) - Number(invoice.total_paid) - Number(invoice.total_credited);
  const creditedForeign = Number(invoice.exchange_rate) > 0 ? Number(invoice.total_credited) / Number(invoice.exchange_rate) : 0;
  invoice.balance_due_foreign = Number(invoice.amount_foreign) - Number(invoice.total_paid_foreign) - creditedForeign;
  res.json({ invoice });
}

// Invoice numbers are per-company, per-year, sequential: INV-2026-0001. Not
// safe under heavy concurrent writes, but this is a small-team sales tool,
// not a high-throughput billing system.
async function generateInvoiceNo(client, companyId) {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const result = await client.query(
    `SELECT invoice_no FROM invoices
     WHERE company_id = $1 AND invoice_no LIKE $2
     ORDER BY invoice_no DESC LIMIT 1`,
    [companyId, `${prefix}%`]
  );
  const lastSeq = result.rows[0] ? parseInt(result.rows[0].invoice_no.slice(prefix.length), 10) : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

// Sales no longer types invoice amounts by hand. The user clicks "Generate
// Draft Invoice(s)" on the contract; the system splits the contract total by
// percentage (a single 100% invoice, or several for milestone billing) and
// creates DRAFT invoices Finance can then review. Contracts not yet invoiced
// are valued at the company's default estimate rate (company_settings) —
// once a draft is generated, Finance edits it with the REAL rate for that
// specific invoice, since a USD contract split into 2-3 installments can
// settle each at a different rate as the market moves.
async function generateDraftInvoices(req, res) {
  const { sales_order_id, splits } = req.body;

  if (!sales_order_id) {
    return res.status(400).json({ error: 'sales_order_id is required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const soResult = await client.query(
      `SELECT id, event_id, exhibitor_id, currency, exchange_rate, total_foreign, bill_to_type, remarks
       FROM sales_orders WHERE id = $1 AND company_id = $2`,
      [sales_order_id, req.companyId]
    );
    const salesOrder = soResult.rows[0];
    if (!salesOrder) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Contract not found.' });
    }

    // Together, all invoices on a contract can't exceed the contract total —
    // tracked in the contract's OWN currency so a run of different actual
    // rates across installments can't drift the balance check.
    const invoicedResult = await client.query(
      `SELECT COALESCE(SUM(amount_foreign), 0) AS total_invoiced
       FROM invoices WHERE sales_order_id = $1 AND company_id = $2`,
      [sales_order_id, req.companyId]
    );
    const contractTotal = Number(salesOrder.total_foreign);
    const remaining = contractTotal - Number(invoicedResult.rows[0].total_invoiced);
    if (remaining <= 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This contract is already fully invoiced.' });
    }

    // Default: one draft invoice for the whole remaining balance. Milestone
    // billing passes several {pct, expected_billing_date} entries (e.g.
    // 50% now, 50% on a future date) that must sum to EXACTLY 100% — a
    // partial split left "unclaimed" would be too easy to lose track of
    // once some lines are scheduled rather than issued immediately.
    const splitList = splits && splits.length ? splits : [{ pct: 100 }];
    const totalPct = splitList.reduce((sum, s) => sum + Number(s.pct), 0);
    if (Math.abs(totalPct - 100) > 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Split percentages must add up to exactly 100% (currently ${totalPct.toFixed(2)}%).` });
    }

    const rate = Number(salesOrder.exchange_rate) || 1;
    const today = new Date().toISOString().slice(0, 10);
    const created = [];
    let allocated = 0;
    for (let i = 0; i < splitList.length; i++) {
      const pct = Number(splitList[i].pct);
      // Last split absorbs any rounding remainder so the splits sum exactly.
      const rawAmount = i === splitList.length - 1
        ? (remaining * totalPct) / 100 - allocated
        : (remaining * pct) / 100;
      const amountForeign = Math.round(rawAmount * 100) / 100;
      allocated += amountForeign;
      const amountMyr = amountForeign * rate;

      // No target date, or a date already in the past/today: issue now, a
      // real DRAFT with an assigned invoice_no. A future date: park it as
      // SCHEDULED — an estimate at today's rate, no invoice_no consumed —
      // until someone actually clicks "Issue" on it (see
      // issueScheduledInvoice below), possibly much later.
      // due_date is the real AR-aging due date — for a Credit Term-driven
      // split it's that installment's own resolved date (even when issued
      // immediately, e.g. a milestone whose date already passed); otherwise
      // it falls back to the issue date itself (due on receipt).
      const expectedDate = splitList[i].expected_billing_date || null;
      if (!expectedDate || expectedDate <= today) {
        const invoiceNo = await generateInvoiceNo(client, req.companyId);
        const result = await client.query(
          `INSERT INTO invoices (company_id, event_id, sales_order_id, exhibitor_id, invoice_no, invoice_date,
                                 currency, amount_foreign, exchange_rate, amount_myr, status, billing_pct, due_date, bill_to_type, remarks)
           VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, $8, $9, 'DRAFT', $10, COALESCE($11::date, CURRENT_DATE), $12, $13)
           RETURNING id, invoice_no, status`,
          [
            req.companyId, salesOrder.event_id, sales_order_id, salesOrder.exhibitor_id,
            invoiceNo, salesOrder.currency, amountForeign, rate, amountMyr, pct, expectedDate, salesOrder.bill_to_type, salesOrder.remarks,
          ]
        );
        created.push(result.rows[0]);
      } else {
        const result = await client.query(
          `INSERT INTO invoices (company_id, event_id, sales_order_id, exhibitor_id,
                                 currency, amount_foreign, exchange_rate, amount_myr, status, billing_pct, expected_billing_date, due_date, bill_to_type, remarks)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'SCHEDULED', $9, $10, $10, $11, $12)
           RETURNING id, status, expected_billing_date`,
          [
            req.companyId, salesOrder.event_id, sales_order_id, salesOrder.exhibitor_id,
            salesOrder.currency, amountForeign, rate, amountMyr, pct, expectedDate, salesOrder.bill_to_type, salesOrder.remarks,
          ]
        );
        created.push(result.rows[0]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ invoices: created });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Converts a planned-but-not-yet-issued milestone into a real draft
// invoice — assigns the invoice_no/invoice_date only now, exactly like a
// CN number is only assigned on approval, not at request time. Anyone who
// can generate invoices can trigger this (matches generateDraftInvoices'
// own permission — not Finance-only, since Sales is who typically issues
// their own milestone billing when it comes due; Finance's own edit/confirm
// gate still applies once it's a real draft).
async function issueScheduledInvoice(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const check = await client.query(
      `SELECT id FROM invoices WHERE id = $1 AND company_id = $2 AND status = 'SCHEDULED' FOR UPDATE`,
      [req.params.id, req.companyId]
    );
    if (!check.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This invoice is not a scheduled milestone.' });
    }
    const invoiceNo = await generateInvoiceNo(client, req.companyId);
    await client.query(
      `UPDATE invoices SET status = 'DRAFT', invoice_no = $1, invoice_date = CURRENT_DATE WHERE id = $2`,
      [invoiceNo, req.params.id]
    );
    await client.query('COMMIT');
    res.json({ success: true, invoice_no: invoiceNo });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Confirming is Finance's call, and ONLY Finance's — explicitly not even
// Admin/Management, per the user's own instruction. Enforced here too, not
// just by hiding the button, since this is the same generic PUT used for
// editing a draft's date/amount/rate.
const CAN_CONFIRM_ROLES = ['FIN'];

async function updateInvoice(req, res) {
  const { amount_foreign, exchange_rate } = req.body;

  if (req.body.status === 'CONFIRMED' && !CAN_CONFIRM_ROLES.includes(req.roleCode)) {
    return res.status(403).json({ error: 'Only Finance can confirm an invoice.' });
  }

  // A SCHEDULED milestone isn't a real financial document yet — just a
  // planned billing split — so Sales may re-split its amount_foreign
  // themselves (e.g. right after a Contract Reduction changes how much is
  // left to invoice), without needing Finance. Once it's a real DRAFT/
  // CONFIRMED invoice, amount/rate edits go back to Finance-only, same as
  // invoice_no/invoice_date always are.
  let invoiceStatus = null;
  if (amount_foreign !== undefined) {
    const statusResult = await pool.query(`SELECT status FROM invoices WHERE id = $1 AND company_id = $2`, [req.params.id, req.companyId]);
    invoiceStatus = statusResult.rows[0]?.status || null;
  }
  const amountEditAllowedForSales = amount_foreign !== undefined && exchange_rate === undefined && invoiceStatus === 'SCHEDULED';

  // Editing invoice_no/invoice_date/exchange_rate is Finance-only, whether
  // the invoice is still a draft or already confirmed — the amount itself
  // is controlled by the contract's own billing, not typed here (except the
  // SCHEDULED-milestone case above). Aging follow-up fields
  // (expected_payment_date/aging_notes) are a separate Sales-facing feature
  // on the Aging report and stay open to anyone.
  const restrictedFields = ['invoice_no', 'invoice_date'];
  const touchesRestrictedFields = restrictedFields.some((f) => f in req.body) || amount_foreign !== undefined || exchange_rate !== undefined;
  if (touchesRestrictedFields && !amountEditAllowedForSales && !CAN_CONFIRM_ROLES.includes(req.roleCode)) {
    return res.status(403).json({ error: 'Only Finance can edit an invoice.' });
  }

  const fields = {};
  for (const field of ['invoice_no', 'invoice_date', 'status', 'discount_type', 'discount_value', 'expected_payment_date', 'aging_notes', 'bill_to_type', 'remarks']) {
    if (field in req.body) fields[field] = req.body[field] === '' ? null : req.body[field];
  }
  // Stamped automatically, not sent by the client — the "last touched" time
  // for the Aging follow-up fields specifically, not a generic updated_at.
  if ('expected_payment_date' in fields || 'aging_notes' in fields) {
    fields.aging_updated_at = new Date();
  }

  // amount_foreign/exchange_rate are linked — recompute amount_myr together
  // whenever either changes, rather than letting them drift out of sync.
  if (amount_foreign !== undefined || exchange_rate !== undefined) {
    const current = await pool.query(
      `SELECT amount_foreign, exchange_rate FROM invoices WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.companyId]
    );
    if (!current.rows[0]) {
      return res.status(404).json({ error: 'Invoice not found.' });
    }
    const newForeign = amount_foreign !== undefined ? Number(amount_foreign) : Number(current.rows[0].amount_foreign);
    const newRate = exchange_rate !== undefined ? Number(exchange_rate) : Number(current.rows[0].exchange_rate);
    fields.amount_foreign = newForeign;
    fields.exchange_rate = newRate;
    fields.amount_myr = newForeign * newRate;
  }

  // Finance changing invoice_no/date/rate on an ALREADY-confirmed invoice
  // (see item 9) re-opens the same Task To-Do notification Sales got when
  // it was first confirmed — they saw the original figures, not these.
  if (touchesRestrictedFields) {
    const statusCheck = await pool.query(`SELECT status FROM invoices WHERE id = $1 AND company_id = $2`, [req.params.id, req.companyId]);
    if (statusCheck.rows[0]?.status === 'CONFIRMED') {
      fields.confirm_acknowledged_by = null;
      fields.confirm_acknowledged_at = null;
    }
  }

  const columns = Object.keys(fields);

  if (columns.length === 0) {
    return res.json({ invoice: { id: req.params.id } });
  }

  const setClause = columns.map((c, i) => `${c} = $${i + 3}`).join(', ');
  const result = await pool.query(
    `UPDATE invoices SET ${setClause}
     WHERE id = $1 AND company_id = $2
     RETURNING id, sales_order_id`,
    [req.params.id, req.companyId, ...columns.map((c) => fields[c])]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: 'Invoice not found.' });
  }

  // Remarks is one shared value per deal — push it up to this Invoice's
  // Contract (and, via the Contract, its Opportunity) and out to every
  // sibling Invoice under the same Contract, same as editing it on the
  // Opportunity/Contract screens pushes back down here.
  if ('remarks' in fields) {
    const soId = result.rows[0].sales_order_id;
    const so = await pool.query(
      `UPDATE sales_orders SET remarks = $1 WHERE id = $2 AND company_id = $3 RETURNING opportunity_id`,
      [fields.remarks, soId, req.companyId]
    );
    if (so.rows[0]?.opportunity_id) {
      await pool.query(
        `UPDATE opportunities SET remarks = $1 WHERE id = $2 AND company_id = $3`,
        [fields.remarks, so.rows[0].opportunity_id, req.companyId]
      );
    }
    await pool.query(
      `UPDATE invoices SET remarks = $1 WHERE sales_order_id = $2 AND company_id = $3 AND id != $4`,
      [fields.remarks, soId, req.companyId, req.params.id]
    );
  }

  res.json({ invoice: { id: req.params.id } });
}

// A DRAFT invoice isn't a real financial document yet — Finance hasn't
// confirmed it, so Sales can pull it back the same way they can withdraw a
// contract from approval. Once CONFIRMED, this is a real invoice; use a
// Credit Note instead.
async function withdrawInvoice(req, res) {
  const result = await pool.query(
    `DELETE FROM invoices WHERE id = $1 AND company_id = $2 AND status IN ('DRAFT', 'SCHEDULED') RETURNING id`,
    [req.params.id, req.companyId]
  );
  if (!result.rows[0]) {
    return res.status(400).json({ error: 'Only a draft or scheduled (not yet confirmed) invoice can be withdrawn.' });
  }
  res.json({ success: true });
}

// Same "unread until acknowledged" pattern as payment_allocations
// (payments.controller.js's acknowledgeAllocation) — the salesperson (or
// Admin) clears their own Task To-Do item once they've actually seen that
// Finance confirmed their invoice.
async function acknowledgeConfirm(req, res) {
  const check = await pool.query(
    `SELECT so.salesperson_id
     FROM invoices inv
     JOIN sales_orders so ON so.id = inv.sales_order_id
     WHERE inv.id = $1 AND inv.company_id = $2`,
    [req.params.id, req.companyId]
  );
  const row = check.rows[0];
  if (!row) return res.status(404).json({ error: 'Invoice not found.' });
  if (req.roleCode !== 'ADM' && row.salesperson_id !== req.userId) {
    return res.status(403).json({ error: 'Only the assigned salesperson (or Admin) can acknowledge this.' });
  }

  await pool.query(
    `UPDATE invoices SET confirm_acknowledged_by = $1, confirm_acknowledged_at = now() WHERE id = $2`,
    [req.userId, req.params.id]
  );
  res.json({ success: true });
}

module.exports = { listInvoices, getInvoice, generateDraftInvoices, issueScheduledInvoice, updateInvoice, withdrawInvoice, acknowledgeConfirm };
