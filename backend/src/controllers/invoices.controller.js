const { pool } = require('../config/db');
const { visibilityClause } = require('../utils/visibility');

async function listInvoices(req, res) {
  const { event_id, sales_order_id, search } = req.query;
  if (!event_id && !sales_order_id) {
    return res.status(400).json({ error: 'event_id or sales_order_id is required.' });
  }

  // invoices has no salesperson_id of its own — visibility rides on the
  // contract's salesperson via sales_orders.
  const vis = visibilityClause(req, 'so.salesperson_id', 5);

  const result = await pool.query(
    `SELECT inv.id, inv.invoice_no, inv.invoice_date, inv.amount_myr, inv.sales_order_id,
            inv.currency, inv.amount_foreign, inv.exchange_rate, inv.status, inv.billing_pct,
            ex.company_name AS exhibitor_name
     FROM invoices inv
     JOIN exhibitors ex ON ex.id = inv.exhibitor_id
     JOIN sales_orders so ON so.id = inv.sales_order_id
     WHERE inv.company_id = $1
       AND ($2::uuid IS NULL OR inv.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2))
       AND ($3::uuid IS NULL OR inv.sales_order_id = $3)
       AND ($4 = '' OR ex.company_name ILIKE '%' || $4 || '%')
       AND ${vis.sql}
     ORDER BY inv.invoice_date DESC NULLS LAST, inv.invoice_no DESC`,
    [req.companyId, event_id || null, sales_order_id || null, search || '', ...(vis.param !== undefined ? [vis.param] : [])]
  );

  res.json({ invoices: result.rows });
}

async function getInvoice(req, res) {
  const vis = visibilityClause(req, 'so.salesperson_id', 3);
  const result = await pool.query(
    `SELECT inv.*,
            ex.company_name, ex.country_code, ex.contact1_name, ex.contact1_email, ex.contact1_phone,
            ex.postcode, ex.city, ex.reg_no, ex.tin_no, ex.sst_no,
            ex.billing_name, ex.billing_address, ex.billing_postcode, ex.billing_city,
            ex.billing_country_code, ex.billing_reg_no, ex.billing_tin_no, ex.billing_sst_no,
            ex.billing_contact_no, ex.billing_email, ex.billing_same_as_company,
            ev.name AS event_name,
            so.contract_type, so.contract_date,
            o.booth_sqm, o.booth_type,
            COALESCE((SELECT SUM(amount_myr) FROM payments WHERE invoice_id = inv.id), 0) AS total_paid
     FROM invoices inv
     JOIN exhibitors ex ON ex.id = inv.exhibitor_id
     JOIN events ev ON ev.id = inv.event_id
     JOIN sales_orders so ON so.id = inv.sales_order_id
     LEFT JOIN opportunities o ON o.id = so.opportunity_id
     WHERE inv.id = $1 AND inv.company_id = $2 AND ${vis.sql}`,
    [req.params.id, req.companyId, ...(vis.param !== undefined ? [vis.param] : [])]
  );

  const invoice = result.rows[0];
  if (!invoice) {
    return res.status(404).json({ error: 'Invoice not found.' });
  }

  invoice.balance_due = Number(invoice.amount_myr) - Number(invoice.total_paid);
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
      `SELECT id, event_id, exhibitor_id, currency, exchange_rate, total_foreign
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
    // billing passes several {pct} entries (e.g. 20/50/30) that must sum to
    // at most 100% of the remaining balance.
    const splitList = splits && splits.length ? splits : [{ pct: 100 }];
    const totalPct = splitList.reduce((sum, s) => sum + Number(s.pct), 0);
    if (totalPct > 100.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Split percentages add up to more than 100%.' });
    }

    const rate = Number(salesOrder.exchange_rate) || 1;
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

      const invoiceNo = await generateInvoiceNo(client, req.companyId);
      const result = await client.query(
        `INSERT INTO invoices (company_id, event_id, sales_order_id, exhibitor_id, invoice_no, invoice_date,
                               currency, amount_foreign, exchange_rate, amount_myr, status, billing_pct)
         VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, $8, $9, 'DRAFT', $10)
         RETURNING id, invoice_no`,
        [
          req.companyId, salesOrder.event_id, sales_order_id, salesOrder.exhibitor_id,
          invoiceNo, salesOrder.currency, amountForeign, rate, amountMyr, pct,
        ]
      );
      created.push(result.rows[0]);
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

async function updateInvoice(req, res) {
  const { amount_foreign, exchange_rate } = req.body;

  const fields = {};
  for (const field of ['invoice_no', 'invoice_date', 'status', 'discount_type', 'discount_value']) {
    if (field in req.body) fields[field] = req.body[field] === '' ? null : req.body[field];
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

  const columns = Object.keys(fields);

  if (columns.length === 0) {
    return res.json({ invoice: { id: req.params.id } });
  }

  const setClause = columns.map((c, i) => `${c} = $${i + 3}`).join(', ');
  const result = await pool.query(
    `UPDATE invoices SET ${setClause}
     WHERE id = $1 AND company_id = $2
     RETURNING id`,
    [req.params.id, req.companyId, ...columns.map((c) => fields[c])]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: 'Invoice not found.' });
  }

  res.json({ invoice: { id: req.params.id } });
}

module.exports = { listInvoices, getInvoice, generateDraftInvoices, updateInvoice };
