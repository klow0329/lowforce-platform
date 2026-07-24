const { pool } = require('../config/db');

// A payment is money actually received from a customer — it's no longer
// tied to a single invoice. It gets allocated (in full, in part, or split
// across several invoices) via payment_allocations; whatever isn't
// allocated yet is that customer's usable credit. See migration
// 019_payment_allocations.sql for why (underpayment already worked with
// the old strict 1-payment-per-invoice model; this is for overpayment and
// lump-sum payments — an agent paying one amount against many invoices
// without saying which up front).

// invoice_id is still accepted as a query param for the common case (the
// Invoice screen's own payment list) — it lists only the allocations
// touching that invoice, alongside the payment they came from.
async function listPayments(req, res) {
  const { invoice_id, exhibitor_id } = req.query;
  if (!invoice_id && !exhibitor_id) {
    return res.status(400).json({ error: 'invoice_id or exhibitor_id is required.' });
  }

  if (invoice_id) {
    const result = await pool.query(
      `SELECT p.id, p.payment_date, p.amount_myr AS payment_total_myr, p.payment_method, p.bank_ref, p.receipt_no,
              pa.amount_myr AS allocated_amount_myr
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       WHERE pa.invoice_id = $1 AND p.company_id = $2
       ORDER BY p.payment_date DESC NULLS LAST`,
      [invoice_id, req.companyId]
    );
    return res.json({ payments: result.rows });
  }

  // Exhibitor-level view — every payment received from this customer, with
  // how much of it is still unallocated (their available credit), used by
  // the lump-sum payment/allocation screen and the Statement of Account.
  const result = await pool.query(
    `SELECT p.id, p.payment_date, p.amount_myr, p.payment_method, p.bank_ref, p.receipt_no,
            COALESCE((SELECT SUM(amount_myr) FROM payment_allocations WHERE payment_id = p.id), 0) AS allocated_myr,
            p.amount_myr - COALESCE((SELECT SUM(amount_myr) FROM payment_allocations WHERE payment_id = p.id), 0) AS unallocated_myr
     FROM payments p
     WHERE p.company_id = $1 AND p.exhibitor_id = $2
     ORDER BY p.payment_date DESC NULLS LAST`,
    [req.companyId, exhibitor_id]
  );
  res.json({ payments: result.rows });
}

async function getPayment(req, res) {
  const result = await pool.query(
    `SELECT p.*, ex.company_name, ev.name AS event_name
     FROM payments p
     JOIN exhibitors ex ON ex.id = p.exhibitor_id
     LEFT JOIN events ev ON ev.id = p.event_id
     WHERE p.id = $1 AND p.company_id = $2`,
    [req.params.id, req.companyId]
  );
  const payment = result.rows[0];
  if (!payment) {
    return res.status(404).json({ error: 'Payment not found.' });
  }

  const allocResult = await pool.query(
    `SELECT pa.id, pa.invoice_id, pa.amount_myr, inv.invoice_no
     FROM payment_allocations pa
     JOIN invoices inv ON inv.id = pa.invoice_id
     WHERE pa.payment_id = $1
     ORDER BY inv.invoice_no`,
    [req.params.id]
  );
  payment.allocations = allocResult.rows;
  payment.allocated_myr = allocResult.rows.reduce((sum, a) => sum + Number(a.amount_myr), 0);
  payment.unallocated_myr = Number(payment.amount_myr) - payment.allocated_myr;

  res.json({ payment });
}

async function generateReceiptNo(client, companyId) {
  const year = new Date().getFullYear();
  const prefix = `OR-${year}-`;
  const result = await client.query(
    `SELECT receipt_no FROM payments
     WHERE company_id = $1 AND receipt_no LIKE $2
     ORDER BY receipt_no DESC LIMIT 1`,
    [companyId, `${prefix}%`]
  );
  const lastSeq = result.rows[0] ? parseInt(result.rows[0].receipt_no.slice(prefix.length), 10) : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

// allocations is optional and can be partial — the whole point is a lump
// sum doesn't have to be assigned to specific invoices up front. Each
// allocation can also exceed its own invoice's remaining balance (a
// customer overpaying one specific bill by mistake is a real scenario the
// user described) — the only hard rule is you can't allocate more in total
// than was actually received.
async function createPayment(req, res) {
  const { exhibitor_id, event_id, payment_date, amount_myr, payment_method, bank_ref, allocations } = req.body;

  if (!exhibitor_id || !amount_myr) {
    return res.status(400).json({ error: 'exhibitor_id and amount_myr are required.' });
  }

  const allocList = Array.isArray(allocations) ? allocations.filter((a) => a.invoice_id && Number(a.amount_myr) > 0) : [];
  const allocTotal = allocList.reduce((sum, a) => sum + Number(a.amount_myr), 0);
  if (allocTotal > Number(amount_myr) + 0.01) {
    return res.status(400).json({ error: `Allocations (RM ${allocTotal.toFixed(2)}) can't exceed the amount received (RM ${Number(amount_myr).toFixed(2)}).` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const exResult = await client.query(`SELECT id FROM exhibitors WHERE id = $1 AND company_id = $2`, [exhibitor_id, req.companyId]);
    if (!exResult.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Exhibitor not found.' });
    }

    if (allocList.length > 0) {
      const invIds = allocList.map((a) => a.invoice_id);
      const invResult = await client.query(
        `SELECT id FROM invoices WHERE id = ANY($1) AND company_id = $2 AND exhibitor_id = $3`,
        [invIds, req.companyId, exhibitor_id]
      );
      if (invResult.rows.length !== new Set(invIds).size) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'One or more invoices are invalid for this customer.' });
      }
    }

    const receiptNo = await generateReceiptNo(client, req.companyId);

    const result = await client.query(
      `INSERT INTO payments (company_id, exhibitor_id, event_id, payment_date, amount_myr, payment_method, bank_ref, receipt_no)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [req.companyId, exhibitor_id, event_id || null, payment_date || null, amount_myr, payment_method || null, bank_ref || null, receiptNo]
    );
    const paymentId = result.rows[0].id;

    for (const a of allocList) {
      await client.query(
        `INSERT INTO payment_allocations (payment_id, invoice_id, amount_myr) VALUES ($1, $2, $3)`,
        [paymentId, a.invoice_id, a.amount_myr]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ payment: { id: paymentId } });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Adds one more allocation to a payment that already exists — the
// "agent paid a lump sum, didn't say which invoices, Finance figures it
// out later (maybe in pieces)" flow.
async function addAllocation(req, res) {
  const { invoice_id, amount_myr } = req.body;
  if (!invoice_id || !amount_myr) {
    return res.status(400).json({ error: 'invoice_id and amount_myr are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const payResult = await client.query(
      `SELECT p.id, p.amount_myr, p.exhibitor_id,
              COALESCE((SELECT SUM(amount_myr) FROM payment_allocations WHERE payment_id = p.id), 0) AS allocated
       FROM payments p WHERE p.id = $1 AND p.company_id = $2`,
      [req.params.id, req.companyId]
    );
    const payment = payResult.rows[0];
    if (!payment) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Payment not found.' });
    }

    const unallocated = Number(payment.amount_myr) - Number(payment.allocated);
    if (Number(amount_myr) > unallocated + 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Only RM ${unallocated.toFixed(2)} of this payment is unallocated.` });
    }

    const invResult = await client.query(
      `SELECT id FROM invoices WHERE id = $1 AND company_id = $2 AND exhibitor_id = $3`,
      [invoice_id, req.companyId, payment.exhibitor_id]
    );
    if (!invResult.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'That invoice does not belong to this payment\'s customer.' });
    }

    const result = await client.query(
      `INSERT INTO payment_allocations (payment_id, invoice_id, amount_myr) VALUES ($1, $2, $3) RETURNING id`,
      [req.params.id, invoice_id, amount_myr]
    );

    await client.query('COMMIT');
    res.status(201).json({ allocation: { id: result.rows[0].id } });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Removes a mis-allocation (e.g. Finance put it on the wrong invoice) —
// the amount just goes back to being unallocated credit on the payment.
async function deleteAllocation(req, res) {
  const result = await pool.query(
    `DELETE FROM payment_allocations pa
     USING payments p
     WHERE pa.payment_id = p.id AND pa.id = $1 AND p.id = $2 AND p.company_id = $3
     RETURNING pa.id`,
    [req.params.allocationId, req.params.id, req.companyId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Allocation not found.' });
  res.json({ success: true });
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

  // Can't shrink a payment below what's already allocated out of it.
  if ('amount_myr' in fields) {
    const allocResult = await pool.query(
      `SELECT COALESCE(SUM(amount_myr), 0) AS allocated FROM payment_allocations WHERE payment_id = $1`,
      [req.params.id]
    );
    const allocated = Number(allocResult.rows[0].allocated);
    if (Number(fields.amount_myr) < allocated - 0.01) {
      return res.status(400).json({ error: `Can't reduce below RM ${allocated.toFixed(2)}, which is already allocated to invoices.` });
    }
  }

  const setClause = columns.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const result = await pool.query(
    `UPDATE payments SET ${setClause} WHERE id = $1 AND company_id = $${columns.length + 2} RETURNING id`,
    [req.params.id, ...columns.map((c) => fields[c]), req.companyId]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: 'Payment not found.' });
  }

  res.json({ payment: { id: req.params.id } });
}

// Marks one allocation's "payment received" Task To-Do item as seen — see
// getTasks in reports.controller.js, which now shows an allocation until
// this is called rather than letting it silently age out after a fixed
// number of days regardless of whether the salesperson ever noticed it.
// Scoped to the deal's own salesperson (or Admin) — the same people the
// to-do item itself is ever shown to.
async function acknowledgeAllocation(req, res) {
  const check = await pool.query(
    `SELECT so.salesperson_id
     FROM payment_allocations pa
     JOIN invoices inv ON inv.id = pa.invoice_id
     JOIN sales_orders so ON so.id = inv.sales_order_id
     WHERE pa.id = $1 AND inv.company_id = $2`,
    [req.params.allocationId, req.companyId]
  );
  const row = check.rows[0];
  if (!row) return res.status(404).json({ error: 'Allocation not found.' });
  if (req.roleCode !== 'ADM' && row.salesperson_id !== req.userId) {
    return res.status(403).json({ error: 'Only the assigned salesperson (or Admin) can acknowledge this.' });
  }

  await pool.query(
    `UPDATE payment_allocations SET acknowledged_by = $1, acknowledged_at = now() WHERE id = $2`,
    [req.userId, req.params.allocationId]
  );
  res.json({ success: true });
}

module.exports = { listPayments, getPayment, createPayment, addAllocation, deleteAllocation, updatePayment, acknowledgeAllocation };
