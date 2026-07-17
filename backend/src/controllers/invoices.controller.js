const { pool } = require('../config/db');

async function listInvoices(req, res) {
  const { event_id, sales_order_id, search } = req.query;
  if (!event_id && !sales_order_id) {
    return res.status(400).json({ error: 'event_id or sales_order_id is required.' });
  }

  const result = await pool.query(
    `SELECT inv.id, inv.invoice_no, inv.invoice_date, inv.amount_myr, inv.sales_order_id,
            ex.company_name AS exhibitor_name
     FROM invoices inv
     JOIN exhibitors ex ON ex.id = inv.exhibitor_id
     WHERE inv.company_id = $1
       AND ($2::uuid IS NULL OR inv.event_id = $2)
       AND ($3::uuid IS NULL OR inv.sales_order_id = $3)
       AND ($4 = '' OR ex.company_name ILIKE '%' || $4 || '%')
     ORDER BY inv.invoice_date DESC NULLS LAST, inv.invoice_no DESC`,
    [req.companyId, event_id || null, sales_order_id || null, search || '']
  );

  res.json({ invoices: result.rows });
}

async function getInvoice(req, res) {
  const result = await pool.query(
    `SELECT inv.*,
            ex.company_name, ex.country_code, ex.contact1_name, ex.contact1_email,
            ex.billing_name, ex.billing_address, ex.billing_country_code, ex.billing_email,
            ex.billing_same_as_company,
            ev.name AS event_name,
            so.contract_type, so.contract_date,
            o.booth_sqm, o.booth_type,
            COALESCE((SELECT SUM(amount_myr) FROM payments WHERE invoice_id = inv.id), 0) AS total_paid
     FROM invoices inv
     JOIN exhibitors ex ON ex.id = inv.exhibitor_id
     JOIN events ev ON ev.id = inv.event_id
     JOIN sales_orders so ON so.id = inv.sales_order_id
     LEFT JOIN opportunities o ON o.id = so.opportunity_id
     WHERE inv.id = $1 AND inv.company_id = $2`,
    [req.params.id, req.companyId]
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

async function createInvoice(req, res) {
  const { sales_order_id, invoice_date, amount_myr } = req.body;

  if (!sales_order_id) {
    return res.status(400).json({ error: 'sales_order_id is required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const soResult = await client.query(
      `SELECT id, event_id, exhibitor_id, total_myr FROM sales_orders WHERE id = $1 AND company_id = $2`,
      [sales_order_id, req.companyId]
    );
    const salesOrder = soResult.rows[0];
    if (!salesOrder) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Contract not found.' });
    }

    // A contract can carry several installment invoices (the Excel workflow
    // billed 20%/50%/100% milestones as IN1-IN4) — the only hard rule is
    // that together they can't exceed the contract total.
    const invoicedResult = await client.query(
      `SELECT COALESCE(SUM(amount_myr), 0) AS total_invoiced
       FROM invoices WHERE sales_order_id = $1 AND company_id = $2`,
      [sales_order_id, req.companyId]
    );
    const remaining = Number(salesOrder.total_myr) - Number(invoicedResult.rows[0].total_invoiced);
    if (remaining <= 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This contract is already fully invoiced.' });
    }

    const invoiceAmount = amount_myr ? Number(amount_myr) : remaining;
    if (invoiceAmount > remaining + 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Invoice exceeds the contract's un-invoiced balance of RM ${remaining.toFixed(2)}.`,
      });
    }

    const invoiceNo = await generateInvoiceNo(client, req.companyId);

    const result = await client.query(
      `INSERT INTO invoices (company_id, event_id, sales_order_id, exhibitor_id, invoice_no, invoice_date, amount_myr)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        req.companyId, salesOrder.event_id, sales_order_id, salesOrder.exhibitor_id,
        invoiceNo, invoice_date || null, invoiceAmount,
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({ invoice: { id: result.rows[0].id } });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateInvoice(req, res) {
  const fields = {};
  for (const field of ['invoice_date', 'amount_myr']) {
    if (field in req.body) fields[field] = req.body[field] === '' ? null : req.body[field];
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

module.exports = { listInvoices, getInvoice, createInvoice, updateInvoice };
