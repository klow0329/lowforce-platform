const { pool } = require('../config/db');
const { getRequiredApprover, canActOnTier } = require('../utils/approverMatrix');

// Credit Notes are a value-REDUCTION against one already-CONFIRMED invoice
// on an already-APPROVED contract. Deliberately kept separate from
// sales_orders.total_myr and every "Contracted"/"Invoiced" figure in the
// Reports module — the contract's own value stays exactly as originally
// approved for revenue/attribution reporting; a CN only ever affects that
// one invoice's outstanding balance (Aging, Dashboard's totalOutstanding,
// Statement of Account), and only once Finance confirms it. See
// database/migrations/023_payment_ack_credit_notes.sql for the full status
// flow (PENDING_APPROVAL -> DRAFT -> CONFIRMED, or REJECTED).

// CN numbers are per-company, per-year, sequential: CN-2026-0001 — assigned
// only on approval (a rejected/never-approved request never consumes a
// number), mirroring generateInvoiceNo in invoices.controller.js.
async function generateCnNo(client, companyId) {
  const year = new Date().getFullYear();
  const prefix = `CN-${year}-`;
  const result = await client.query(
    `SELECT cn_no FROM credit_notes
     WHERE company_id = $1 AND cn_no LIKE $2
     ORDER BY cn_no DESC LIMIT 1`,
    [companyId, `${prefix}%`]
  );
  const lastSeq = result.rows[0] ? parseInt(result.rows[0].cn_no.slice(prefix.length), 10) : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

const DETAIL_SELECT = `
  SELECT cn.*, ex.company_name AS exhibitor_name, ev.name AS event_name,
         inv.invoice_no, inv.amount_myr AS invoice_amount_myr,
         so.legacy_order_no, so.salesperson_id,
         req.full_name AS requested_by_name, appr.full_name AS approved_by_name, conf.full_name AS confirmed_by_name
  FROM credit_notes cn
  JOIN exhibitors ex ON ex.id = cn.exhibitor_id
  JOIN events ev ON ev.id = cn.event_id
  JOIN invoices inv ON inv.id = cn.invoice_id
  JOIN sales_orders so ON so.id = cn.sales_order_id
  LEFT JOIN users req ON req.id = cn.requested_by
  LEFT JOIN users appr ON appr.id = cn.approved_by
  LEFT JOIN users conf ON conf.id = cn.confirmed_by
`;

async function listCreditNotes(req, res) {
  const { sales_order_id, exhibitor_id } = req.query;
  if (!sales_order_id && !exhibitor_id) {
    return res.status(400).json({ error: 'sales_order_id or exhibitor_id is required.' });
  }
  const result = await pool.query(
    `${DETAIL_SELECT}
     WHERE cn.company_id = $1
       AND ($2::uuid IS NULL OR cn.sales_order_id = $2)
       AND ($3::uuid IS NULL OR cn.exhibitor_id = $3)
     ORDER BY cn.created_at DESC`,
    [req.companyId, sales_order_id || null, exhibitor_id || null]
  );
  res.json({ creditNotes: result.rows });
}

async function getCreditNote(req, res) {
  const result = await pool.query(`${DETAIL_SELECT} WHERE cn.id = $1 AND cn.company_id = $2`, [req.params.id, req.companyId]);
  const creditNote = result.rows[0];
  if (!creditNote) return res.status(404).json({ error: 'Credit note not found.' });
  res.json({ creditNote });
}

// The amount already spoken for against this invoice by other CNs still in
// play (pending approval, approved-and-drafted, or already confirmed) — a
// rejected CN doesn't count, freeing that room back up. Keeps a run of
// several partial CNs from ever adding up to more than the invoice itself.
async function committedCnTotal(client, invoiceId, excludeId) {
  const result = await client.query(
    `SELECT COALESCE(SUM(amount_myr), 0) AS total FROM credit_notes
     WHERE invoice_id = $1 AND status != 'REJECTED' AND ($2::uuid IS NULL OR id != $2)`,
    [invoiceId, excludeId || null]
  );
  return Number(result.rows[0].total);
}

async function requestCreditNote(req, res) {
  const { sales_order_id, invoice_id, amount_myr, reason } = req.body;
  if (!sales_order_id || !invoice_id || !amount_myr || !reason) {
    return res.status(400).json({ error: 'sales_order_id, invoice_id, amount_myr and reason are required.' });
  }
  const amount = Number(amount_myr);
  if (!(amount > 0)) return res.status(400).json({ error: 'amount_myr must be positive.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const soResult = await client.query(
      `SELECT id, event_id, exhibitor_id, status FROM sales_orders WHERE id = $1 AND company_id = $2`,
      [sales_order_id, req.companyId]
    );
    const so = soResult.rows[0];
    if (!so) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Contract not found.' }); }
    if (so.status !== 'APPROVED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only an approved contract can have a credit note requested against it.' });
    }

    const invResult = await client.query(
      `SELECT id, amount_myr, status FROM invoices WHERE id = $1 AND sales_order_id = $2 AND company_id = $3`,
      [invoice_id, sales_order_id, req.companyId]
    );
    const invoice = invResult.rows[0];
    if (!invoice) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Invoice not found on this contract.' }); }
    if (invoice.status !== 'CONFIRMED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Credit notes can only be requested against a confirmed invoice.' });
    }

    const alreadyCommitted = await committedCnTotal(client, invoice_id);
    if (amount > Number(invoice.amount_myr) - alreadyCommitted + 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `That exceeds this invoice's remaining room for credit notes (RM${(Number(invoice.amount_myr) - alreadyCommitted).toFixed(2)} available).`,
      });
    }

    const result = await client.query(
      `INSERT INTO credit_notes (company_id, event_id, sales_order_id, exhibitor_id, invoice_id, amount_myr, reason, status, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING_APPROVAL', $8)
       RETURNING id`,
      [req.companyId, so.event_id, sales_order_id, so.exhibitor_id, invoice_id, amount, reason, req.userId]
    );

    await client.query('COMMIT');
    res.status(201).json({ creditNote: { id: result.rows[0].id } });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function approveCreditNote(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cnResult = await client.query(
      `SELECT * FROM credit_notes WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [req.params.id, req.companyId]
    );
    const cn = cnResult.rows[0];
    if (!cn) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Credit note not found.' }); }
    if (cn.status !== 'PENDING_APPROVAL') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This credit note is not pending approval.' });
    }

    const tier = await getRequiredApprover(req.companyId, Number(cn.amount_myr), 'CREDIT_NOTE_ISSUED');
    if (!canActOnTier(req, tier)) {
      await client.query('ROLLBACK');
      const who = tier ? (tier.approver_user_name || `the ${tier.approver_role_code} role`) : 'Admin/Management';
      return res.status(403).json({ error: `Only ${who} can approve this credit note (RM${Number(cn.amount_myr).toLocaleString('en-MY')}).` });
    }

    const cnNo = await generateCnNo(client, req.companyId);
    await client.query(
      `UPDATE credit_notes SET status = 'DRAFT', cn_no = $1, cn_date = CURRENT_DATE, approved_by = $2, approved_at = now() WHERE id = $3`,
      [cnNo, req.userId, req.params.id]
    );

    await client.query('COMMIT');
    res.json({ success: true, cn_no: cnNo });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function rejectCreditNote(req, res) {
  const cnResult = await pool.query(`SELECT amount_myr, status FROM credit_notes WHERE id = $1 AND company_id = $2`, [req.params.id, req.companyId]);
  const cn = cnResult.rows[0];
  if (!cn) return res.status(404).json({ error: 'Credit note not found.' });
  if (cn.status !== 'PENDING_APPROVAL') return res.status(400).json({ error: 'This credit note is not pending approval.' });

  const tier = await getRequiredApprover(req.companyId, Number(cn.amount_myr), 'CREDIT_NOTE_ISSUED');
  if (!canActOnTier(req, tier)) {
    const who = tier ? (tier.approver_user_name || `the ${tier.approver_role_code} role`) : 'Admin/Management';
    return res.status(403).json({ error: `Only ${who} can reject this credit note.` });
  }

  await pool.query(
    `UPDATE credit_notes SET status = 'REJECTED', rejection_notes = $1 WHERE id = $2`,
    [req.body.notes || null, req.params.id]
  );
  res.json({ success: true });
}

// Confirming is Finance's call, and ONLY Finance's — same rule and same
// reasoning as invoice confirmation (invoices.controller.js). This is the
// point a CN actually starts reducing its invoice's outstanding balance;
// see the balance_due queries in invoices.controller.js/reports.controller.js.
const CAN_CONFIRM_ROLES = ['FIN'];

async function confirmCreditNote(req, res) {
  if (!CAN_CONFIRM_ROLES.includes(req.roleCode)) {
    return res.status(403).json({ error: 'Only Finance can confirm a credit note.' });
  }
  const result = await pool.query(
    `UPDATE credit_notes SET status = 'CONFIRMED', confirmed_by = $1, confirmed_at = now()
     WHERE id = $2 AND company_id = $3 AND status = 'DRAFT' RETURNING id`,
    [req.userId, req.params.id, req.companyId]
  );
  if (!result.rows[0]) return res.status(400).json({ error: 'This credit note is not in draft status.' });
  res.json({ success: true });
}

module.exports = { listCreditNotes, getCreditNote, requestCreditNote, approveCreditNote, rejectCreditNote, confirmCreditNote };
