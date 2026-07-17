const { pool } = require('../config/db');

// payments has no company_id of its own — every query joins through
// invoices to enforce tenant scoping, same rule as every other table.
async function listPayments(req, res) {
  const { invoice_id } = req.query;
  if (!invoice_id) {
    return res.status(400).json({ error: 'invoice_id is required.' });
  }

  const result = await pool.query(
    `SELECT p.id, p.payment_date, p.amount_myr, p.payment_method, p.bank_ref, p.receipt_no
     FROM payments p
     JOIN invoices inv ON inv.id = p.invoice_id
     WHERE p.invoice_id = $1 AND inv.company_id = $2
     ORDER BY p.payment_date DESC NULLS LAST`,
    [invoice_id, req.companyId]
  );

  res.json({ payments: result.rows });
}

async function getPayment(req, res) {
  const result = await pool.query(
    `SELECT p.*,
            inv.invoice_no, inv.amount_myr AS invoice_amount_myr,
            ex.company_name, ev.name AS event_name
     FROM payments p
     JOIN invoices inv ON inv.id = p.invoice_id
     JOIN exhibitors ex ON ex.id = inv.exhibitor_id
     JOIN events ev ON ev.id = inv.event_id
     WHERE p.id = $1 AND inv.company_id = $2`,
    [req.params.id, req.companyId]
  );

  const payment = result.rows[0];
  if (!payment) {
    return res.status(404).json({ error: 'Payment not found.' });
  }

  res.json({ payment });
}

async function generateReceiptNo(client, companyId) {
  const year = new Date().getFullYear();
  const prefix = `OR-${year}-`;
  const result = await client.query(
    `SELECT p.receipt_no FROM payments p
     JOIN invoices inv ON inv.id = p.invoice_id
     WHERE inv.company_id = $1 AND p.receipt_no LIKE $2
     ORDER BY p.receipt_no DESC LIMIT 1`,
    [companyId, `${prefix}%`]
  );
  const lastSeq = result.rows[0] ? parseInt(result.rows[0].receipt_no.slice(prefix.length), 10) : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

async function createPayment(req, res) {
  const { invoice_id, payment_date, amount_myr, payment_method, bank_ref } = req.body;

  if (!invoice_id || !amount_myr) {
    return res.status(400).json({ error: 'invoice_id and amount_myr are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const invResult = await client.query(
      `SELECT inv.id, inv.amount_myr,
              COALESCE((SELECT SUM(amount_myr) FROM payments WHERE invoice_id = inv.id), 0) AS total_paid
       FROM invoices inv
       WHERE inv.id = $1 AND inv.company_id = $2`,
      [invoice_id, req.companyId]
    );
    const invoice = invResult.rows[0];
    if (!invoice) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invoice not found.' });
    }

    const balance = Number(invoice.amount_myr) - Number(invoice.total_paid);
    if (Number(amount_myr) > balance + 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Payment exceeds the outstanding balance of RM ${balance.toFixed(2)}.` });
    }

    const receiptNo = await generateReceiptNo(client, req.companyId);

    const result = await client.query(
      `INSERT INTO payments (invoice_id, payment_date, amount_myr, payment_method, bank_ref, receipt_no)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [invoice_id, payment_date || null, amount_myr, payment_method || null, bank_ref || null, receiptNo]
    );

    await client.query('COMMIT');
    res.status(201).json({ payment: { id: result.rows[0].id } });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updatePayment(req, res) {
  const fields = {};
  for (const field of ['payment_date', 'amount_myr', 'payment_method', 'bank_ref']) {
    if (field in req.body) fields[field] = req.body[field] === '' ? null : req.body[field];
  }
  const columns = Object.keys(fields);

  if (columns.length === 0) {
    return res.json({ payment: { id: req.params.id } });
  }

  const setClause = columns.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const result = await pool.query(
    `UPDATE payments p SET ${setClause}
     FROM invoices inv
     WHERE p.invoice_id = inv.id AND p.id = $1 AND inv.company_id = $${columns.length + 2}
     RETURNING p.id`,
    [req.params.id, ...columns.map((c) => fields[c]), req.companyId]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: 'Payment not found.' });
  }

  res.json({ payment: { id: req.params.id } });
}

module.exports = { listPayments, getPayment, createPayment, updatePayment };
