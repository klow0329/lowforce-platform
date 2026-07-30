const { pool } = require('../config/db');
const { getRequiredApprover, canActOnTier } = require('../utils/approverMatrix');
const { recomputeTotals, calcLine } = require('./salesOrderItems.controller');

// Credit Notes are a value-REDUCTION against one already-CONFIRMED invoice
// on an already-APPROVED contract, but — per the user's explicit design
// decision (2026-07-27) — the contract's own real line items/total_sqm/
// total DO get replaced by the CN's adjusted figures the moment it's
// APPROVED (not just once Finance later confirms it for AR purposes). See
// database/migrations/023_payment_ack_credit_notes.sql /
// 031_cn_lifecycle.sql for the full status flow
// (PENDING_APPROVAL -> DRAFT -> CONFIRMED, or REJECTED), and
// released_booth_ids for how Floor Plan booths tie in.

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
         so.legacy_order_no, so.salesperson_id, so.total_sqm AS contract_total_sqm,
         rc.code AS reason_code, rc.label AS reason_label,
         req.full_name AS requested_by_name, appr.full_name AS approved_by_name, conf.full_name AS confirmed_by_name
  FROM credit_notes cn
  JOIN exhibitors ex ON ex.id = cn.exhibitor_id
  JOIN events ev ON ev.id = cn.event_id
  JOIN invoices inv ON inv.id = cn.invoice_id
  JOIN sales_orders so ON so.id = cn.sales_order_id
  LEFT JOIN cn_reason_codes rc ON rc.id = cn.reason_code_id
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
       AND cn.is_active = TRUE
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

// released_booth_ids must actually belong to this contract right now — a
// stale/foreign id here would silently let the request claim a release it
// has no standing to make.
async function validateReleasedBooths(client, companyId, salesOrderId, releasedBoothIds) {
  if (!Array.isArray(releasedBoothIds) || releasedBoothIds.length === 0) return [];
  const result = await client.query(
    `SELECT b.id FROM floor_plan_booths b
     JOIN floor_plan_halls h ON h.id = b.hall_id
     WHERE h.company_id = $1 AND b.sales_order_id = $2 AND b.id = ANY($3::uuid[])`,
    [companyId, salesOrderId, releasedBoothIds]
  );
  if (result.rows.length !== releasedBoothIds.length) {
    throw Object.assign(new Error('One or more booths to release are not currently linked to this contract.'), { status: 400 });
  }
  return releasedBoothIds;
}

// A CN is requested by adjusting the contract's real line items in the
// billing-template UI (see BillingTemplate.jsx's scratch/adjustment mode on
// the frontend) — never by typing a bare RM figure. amount_myr is the
// shortfall the frontend computed (original total minus adjusted total);
// original_items/adjusted_items are a snapshot of what was actually changed.
// released_booth_ids (optional) are the specific Floor Plan booths the user
// picked to release, if lowering Bare Space's qty meant the contract's
// current booth allocation now exceeds the new total — nothing happens to
// them until this CN is actually APPROVED (see approveCreditNote).
async function requestCreditNote(req, res) {
  const { sales_order_id, invoice_id, amount_myr, reason_code_id, notes, original_items, adjusted_items, released_booth_ids } = req.body;
  if (!sales_order_id || !invoice_id || !amount_myr || !reason_code_id) {
    return res.status(400).json({ error: 'sales_order_id, invoice_id, amount_myr and reason_code_id are required.' });
  }
  if (!Array.isArray(original_items) || original_items.length === 0) {
    return res.status(400).json({ error: "A credit note must be based on the contract's actual line items — adjust an item first." });
  }
  const amount = Number(amount_myr);
  if (!(amount > 0)) return res.status(400).json({ error: 'No shortfall was detected — adjust an item down (qty, rate, or remove it) to generate a credit note amount.' });

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

    const reasonCheck = await client.query(
      `SELECT id FROM cn_reason_codes WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [reason_code_id, req.companyId]
    );
    if (!reasonCheck.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid reason category.' });
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

    let releasedBooths;
    try {
      releasedBooths = await validateReleasedBooths(client, req.companyId, sales_order_id, released_booth_ids);
    } catch (err) {
      await client.query('ROLLBACK');
      return res.status(err.status || 400).json({ error: err.message });
    }

    const result = await client.query(
      `INSERT INTO credit_notes
         (company_id, event_id, sales_order_id, exhibitor_id, invoice_id, amount_myr, reason, reason_code_id, original_items, adjusted_items, released_booth_ids, status, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PENDING_APPROVAL', $12)
       RETURNING id`,
      [req.companyId, so.event_id, sales_order_id, so.exhibitor_id, invoice_id, amount, notes || null, reason_code_id, JSON.stringify(original_items), JSON.stringify(adjusted_items || []), releasedBooths, req.userId]
    );

    await client.query(
      `INSERT INTO approval_log (sales_order_id, credit_note_id, action, actor_user_id, notes)
       VALUES ($1, $2, 'CN_REQUESTED', $3, $4)`,
      [sales_order_id, result.rows[0].id, req.userId, `Requested credit of RM${amount.toFixed(2)} against invoice.`]
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

// Sales can edit a still-pending request (the "Edit Now" choice after
// Withdraw) — same validation as a fresh request, just updating the
// existing row in place rather than creating a new one, so its
// created_at/requested_by/id (and any approval_log trail already pointing
// at it) stay intact.
async function updateCreditNote(req, res) {
  const { invoice_id, amount_myr, reason_code_id, notes, original_items, adjusted_items, released_booth_ids } = req.body;
  if (!invoice_id || !amount_myr || !reason_code_id) {
    return res.status(400).json({ error: 'invoice_id, amount_myr and reason_code_id are required.' });
  }
  if (!Array.isArray(original_items) || original_items.length === 0) {
    return res.status(400).json({ error: "A credit note must be based on the contract's actual line items — adjust an item first." });
  }
  const amount = Number(amount_myr);
  if (!(amount > 0)) return res.status(400).json({ error: 'No shortfall was detected — adjust an item down (qty, rate, or remove it) to generate a credit note amount.' });

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
      return res.status(400).json({ error: 'Only a request still pending approval can be edited.' });
    }

    const reasonCheck = await client.query(
      `SELECT id FROM cn_reason_codes WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [reason_code_id, req.companyId]
    );
    if (!reasonCheck.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid reason category.' });
    }

    const invResult = await client.query(
      `SELECT id, amount_myr, status FROM invoices WHERE id = $1 AND sales_order_id = $2 AND company_id = $3`,
      [invoice_id, cn.sales_order_id, req.companyId]
    );
    const invoice = invResult.rows[0];
    if (!invoice) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Invoice not found on this contract.' }); }
    if (invoice.status !== 'CONFIRMED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Credit notes can only be requested against a confirmed invoice.' });
    }

    const alreadyCommitted = await committedCnTotal(client, invoice_id, req.params.id);
    if (amount > Number(invoice.amount_myr) - alreadyCommitted + 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `That exceeds this invoice's remaining room for credit notes (RM${(Number(invoice.amount_myr) - alreadyCommitted).toFixed(2)} available).`,
      });
    }

    let releasedBooths;
    try {
      releasedBooths = await validateReleasedBooths(client, req.companyId, cn.sales_order_id, released_booth_ids);
    } catch (err) {
      await client.query('ROLLBACK');
      return res.status(err.status || 400).json({ error: err.message });
    }

    await client.query(
      `UPDATE credit_notes
       SET invoice_id = $1, amount_myr = $2, reason = $3, reason_code_id = $4,
           original_items = $5, adjusted_items = $6, released_booth_ids = $7
       WHERE id = $8`,
      [invoice_id, amount, notes || null, reason_code_id, JSON.stringify(original_items), JSON.stringify(adjusted_items || []), releasedBooths, req.params.id]
    );

    await client.query(
      `INSERT INTO approval_log (sales_order_id, credit_note_id, action, actor_user_id, notes)
       VALUES ($1, $2, 'CN_EDITED', $3, $4)`,
      [cn.sales_order_id, req.params.id, req.userId, `Updated request to RM${amount.toFixed(2)}.`]
    );

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Withdraw + delete entirely — only while still PENDING_APPROVAL, since
// nothing has touched the real contract/booths yet at that stage (the
// mutation only happens on approveCreditNote below), so "deleting" is just
// removing the request row itself; there's nothing elsewhere to roll back.
async function deleteCreditNote(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cnResult = await client.query(
      `SELECT id, sales_order_id, amount_myr FROM credit_notes WHERE id = $1 AND company_id = $2 AND status = 'PENDING_APPROVAL' FOR UPDATE`,
      [req.params.id, req.companyId]
    );
    const cn = cnResult.rows[0];
    if (!cn) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only a request still pending approval can be withdrawn and deleted.' });
    }

    await client.query(
      `INSERT INTO approval_log (sales_order_id, credit_note_id, action, actor_user_id, notes)
       VALUES ($1, $2, 'CN_WITHDRAWN', $3, $4)`,
      [cn.sales_order_id, null, req.userId, `Withdrew and deleted the RM${Number(cn.amount_myr).toFixed(2)} request.`]
    );
    // credit_note_id set NULL above (not $2 = cn.id) since the row is about
    // to be deleted — the log entry stands alone as the only remaining
    // record that this request ever existed.
    await client.query(`DELETE FROM credit_notes WHERE id = $1`, [req.params.id]);

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Approving a CN now does three things in one transaction (2026-07-27
// design decision — previously this only assigned cn_no/status and left the
// contract itself untouched):
//   1. Releases whichever Floor Plan booths this request staged for release.
//   2. Replaces the contract's real sales_order_items with the CN's
//      adjusted_items snapshot, and updates total_sqm to match Bare Space's
//      new qty.
//   3. Recomputes the contract's totals from those new items.
// Only Finance's later confirmCreditNote step affects the INVOICE balance —
// this step is the contract-value/booth-allocation change.
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

    const beforeSo = await client.query(
      `SELECT total_myr, total_sqm FROM sales_orders WHERE id = $1 AND company_id = $2`,
      [cn.sales_order_id, req.companyId]
    );
    const beforeTotalMyr = Number(beforeSo.rows[0]?.total_myr) || 0;
    const beforeTotalSqm = beforeSo.rows[0]?.total_sqm;

    const cnNo = await generateCnNo(client, req.companyId);
    await client.query(
      `UPDATE credit_notes SET status = 'DRAFT', cn_no = $1, cn_date = CURRENT_DATE, approved_by = $2, approved_at = now() WHERE id = $3`,
      [cnNo, req.userId, req.params.id]
    );

    // 1. Release the staged booths — they go back to AVAILABLE, same
    // cleanup cascadeReleaseIfNeeded already does in floorPlan.controller.js
    // (clear fascia/exhibitor name, not just the link) so nothing stale
    // lingers once the booth is genuinely back in the pool.
    if (cn.released_booth_ids && cn.released_booth_ids.length > 0) {
      await client.query(
        `UPDATE floor_plan_booths
         SET status = 'AVAILABLE', sales_order_id = NULL, assigned_exhibitor_name = NULL, fascia_name = NULL
         WHERE id = ANY($1::uuid[])`,
        [cn.released_booth_ids]
      );
    }

    // 2. Replace the contract's real line items with the CN's own snapshot
    // of what was adjusted — recomputing tax/discount server-side exactly
    // like addItem does, never trusting the client-submitted line_total.
    const adjustedItems = cn.adjusted_items || [];
    await client.query(`DELETE FROM sales_order_items WHERE sales_order_id = $1`, [cn.sales_order_id]);
    let sortOrder = 1;
    for (const item of adjustedItems) {
      let taxRatePct = 0;
      if (item.tax_code_id) {
        const tc = await client.query(`SELECT rate_pct FROM tax_codes WHERE id = $1 AND company_id = $2`, [item.tax_code_id, req.companyId]);
        taxRatePct = tc.rows[0] ? Number(tc.rows[0].rate_pct) : 0;
      }
      const qtyNum = Number(item.qty) || 0;
      const unitPriceNum = Number(item.unit_price) || 0;
      const discountType = item.discount_value ? 'PERCENT' : null;
      const { subtotal, discountAmount, taxAmount, lineTotal } = calcLine({
        qty: qtyNum, unit_price: unitPriceNum, discount_type: discountType, discount_value: item.discount_value, tax_rate_pct: taxRatePct,
      });
      await client.query(
        `INSERT INTO sales_order_items
           (sales_order_id, sales_item_code, description, category, qty, unit_price,
            discount_type, discount_value, tax_code_id, tax_rate_pct, subtotal, discount_amount, tax_amount, line_total, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          cn.sales_order_id, item.sales_item_code, item.description || null, item.category || 'OTHER',
          qtyNum, unitPriceNum, discountType, item.discount_value || null, item.tax_code_id || null, taxRatePct,
          subtotal, discountAmount, taxAmount, lineTotal, sortOrder++,
        ]
      );
    }

    // total_sqm always mirrors Bare Space's own qty (see BillingTemplate.jsx
    // — an upgrade item is priced per the SAME sqm, never additional space).
    const basItem = adjustedItems.find((it) => it.sales_item_code === 'BAS');
    await client.query(
      `UPDATE sales_orders SET total_sqm = $1 WHERE id = $2 AND company_id = $3`,
      [basItem ? Number(basItem.qty) || 0 : null, cn.sales_order_id, req.companyId]
    );

    // 3. Recompute the contract's own totals from those new items.
    const afterTotalMyr = await recomputeTotals(client, cn.sales_order_id, req.companyId);
    const afterTotalSqm = basItem ? Number(basItem.qty) || 0 : null;

    await client.query(
      `INSERT INTO approval_log (sales_order_id, credit_note_id, action, actor_user_id, notes)
       VALUES ($1, $2, 'CN_APPROVED', $3, $4)`,
      [
        cn.sales_order_id, req.params.id, req.userId,
        `Approved ${cnNo} — RM${Number(cn.amount_myr).toFixed(2)} credited. Contract value RM${beforeTotalMyr.toFixed(2)} → RM${Number(afterTotalMyr).toFixed(2)}` +
          (beforeTotalSqm !== afterTotalSqm ? `, Total Sqm ${beforeTotalSqm ?? '—'} → ${afterTotalSqm ?? '—'}` : '') + '.',
      ]
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
  const cnResult = await pool.query(`SELECT amount_myr, status, sales_order_id FROM credit_notes WHERE id = $1 AND company_id = $2`, [req.params.id, req.companyId]);
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
  await pool.query(
    `INSERT INTO approval_log (sales_order_id, credit_note_id, action, actor_user_id, notes) VALUES ($1, $2, 'CN_REJECTED', $3, $4)`,
    [cn.sales_order_id, req.params.id, req.userId, req.body.notes || 'Rejected.']
  );
  res.json({ success: true });
}

// Confirming is Finance's call, and ONLY Finance's — same rule and same
// reasoning as invoice confirmation (invoices.controller.js). This is the
// point a CN actually starts reducing its invoice's outstanding balance.
// Gated on at least one attachment, same as issuing an Invoice.
const CAN_CONFIRM_ROLES = ['FIN'];

async function confirmCreditNote(req, res) {
  if (!CAN_CONFIRM_ROLES.includes(req.roleCode)) {
    return res.status(403).json({ error: 'Only Finance can confirm a credit note.' });
  }
  const cnResult = await pool.query(`SELECT id, sales_order_id, amount_myr, status FROM credit_notes WHERE id = $1 AND company_id = $2`, [req.params.id, req.companyId]);
  const cn = cnResult.rows[0];
  if (!cn || cn.status !== 'DRAFT') return res.status(400).json({ error: 'This credit note is not in draft status.' });

  const attachmentCheck = await pool.query(`SELECT id FROM credit_note_attachments WHERE credit_note_id = $1 LIMIT 1`, [req.params.id]);
  if (!attachmentCheck.rows[0]) {
    return res.status(400).json({ error: 'Upload a supporting document before confirming this credit note.' });
  }

  const result = await pool.query(
    `UPDATE credit_notes SET status = 'CONFIRMED', confirmed_by = $1, confirmed_at = now()
     WHERE id = $2 AND company_id = $3 AND status = 'DRAFT' RETURNING id`,
    [req.userId, req.params.id, req.companyId]
  );
  if (!result.rows[0]) return res.status(400).json({ error: 'This credit note is not in draft status.' });

  await pool.query(
    `INSERT INTO approval_log (sales_order_id, credit_note_id, action, actor_user_id, notes) VALUES ($1, $2, 'CN_CONFIRMED', $3, $4)`,
    [cn.sales_order_id, req.params.id, req.userId, `Confirmed — RM${Number(cn.amount_myr).toFixed(2)} now applied against the invoice.`]
  );
  res.json({ success: true });
}

// Mirrors invoices.controller.js's acknowledgeConfirm — lets Sales clear the
// "credit note confirmed by Finance" Task To-Do item once they've seen it.
async function acknowledgeCnConfirm(req, res) {
  const result = await pool.query(
    `UPDATE credit_notes SET confirm_acknowledged_by = $1, confirm_acknowledged_at = now()
     WHERE id = $2 AND company_id = $3 AND status = 'CONFIRMED' RETURNING id`,
    [req.userId, req.params.id, req.companyId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Credit note not found or not confirmed.' });
  res.json({ success: true });
}

module.exports = {
  listCreditNotes, getCreditNote, requestCreditNote, updateCreditNote, deleteCreditNote,
  approveCreditNote, rejectCreditNote, confirmCreditNote, acknowledgeCnConfirm,
};
