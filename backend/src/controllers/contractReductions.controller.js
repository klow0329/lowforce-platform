const { pool } = require('../config/db');
const { getRequiredApprover, canActOnTier } = require('../utils/approverMatrix');
const { recomputeTotals, calcLine } = require('./salesOrderItems.controller');

// Contract Reduction is requested the same way the old item-based Credit
// Note flow worked — Sales edits the contract's actual line items (in the
// BillingTemplate UI, adjustment mode) and releases any excess booths on
// the Floor Plan — never by typing a bare target total. The system derives
// new_total_foreign from those items itself, and works out whether a
// shortfall against already-CONFIRMED invoices exists (cn_amount_myr):
//   - new total still covers everything already invoiced -> no CN, just the
//     reduction itself needs approval; Sales manually re-splits whatever
//     hasn't been invoiced yet afterward.
//   - new total is less than what's already invoiced -> the excess must
//     come back as a Credit Note; approved together with the reduction in
//     one request (no separate approval step for the CN).
// Approval mutates the contract's real items/booths immediately (same
// pattern as Credit Notes) but does NOT auto-create the Credit Note
// document — Sales explicitly issues that afterward against whichever
// invoice they pick (see issueContractReductionCn), then Finance confirms
// it exactly like any other Credit Note.

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
  SELECT cr.*, ex.company_name AS exhibitor_name, ev.name AS event_name,
         so.legacy_order_no, so.salesperson_id, so.currency,
         rc.code AS reason_code, rc.label AS reason_label,
         req.full_name AS requested_by_name, appr.full_name AS approved_by_name
  FROM contract_reductions cr
  JOIN exhibitors ex ON ex.id = cr.exhibitor_id
  JOIN events ev ON ev.id = cr.event_id
  JOIN sales_orders so ON so.id = cr.sales_order_id
  LEFT JOIN cn_reason_codes rc ON rc.id = cr.reason_code_id
  LEFT JOIN users req ON req.id = cr.requested_by
  LEFT JOIN users appr ON appr.id = cr.approved_by
`;

async function listContractReductions(req, res) {
  const { sales_order_id } = req.query;
  if (!sales_order_id) return res.status(400).json({ error: 'sales_order_id is required.' });
  const result = await pool.query(
    `${DETAIL_SELECT} WHERE cr.company_id = $1 AND cr.sales_order_id = $2 ORDER BY cr.created_at DESC`,
    [req.companyId, sales_order_id]
  );
  res.json({ contractReductions: result.rows });
}

async function getContractReduction(req, res) {
  const result = await pool.query(`${DETAIL_SELECT} WHERE cr.id = $1 AND cr.company_id = $2`, [req.params.id, req.companyId]);
  const contractReduction = result.rows[0];
  if (!contractReduction) return res.status(404).json({ error: 'Contract reduction not found.' });
  const cns = await pool.query(
    `SELECT id, cn_no, status, invoice_id, amount_myr FROM credit_notes WHERE contract_reduction_id = $1 ORDER BY created_at`,
    [req.params.id]
  );
  res.json({ contractReduction, creditNotes: cns.rows });
}

// The amount already spoken for against this invoice by other live CNs —
// mirrors creditNotes.controller.js's own committedCnTotal — keeps a
// shortfall allocation from ever pushing an invoice's total credited past
// its own value.
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
// has no standing to make. Mirrors creditNotes.controller.js's own check.
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

// Recomputes each submitted item's money server-side (never trusts a
// client-submitted line_total) purely to get the new contract total for
// validation/shortfall math — the items themselves are stored as submitted
// and only actually applied to sales_order_items once approved.
async function computeItemsTotal(client, companyId, items) {
  let total = 0;
  for (const item of items) {
    let taxRatePct = 0;
    if (item.tax_code_id) {
      const tc = await client.query(`SELECT rate_pct FROM tax_codes WHERE id = $1 AND company_id = $2`, [item.tax_code_id, companyId]);
      taxRatePct = tc.rows[0] ? Number(tc.rows[0].rate_pct) : 0;
    }
    const discountType = item.discount_value ? 'PERCENT' : null;
    const { lineTotal } = calcLine({
      qty: Number(item.qty) || 0, unit_price: Number(item.unit_price) || 0,
      discount_type: discountType, discount_value: item.discount_value, tax_rate_pct: taxRatePct,
    });
    total += lineTotal;
  }
  return total;
}

async function requestContractReduction(req, res) {
  const { sales_order_id, reason_code_id, notes, items, released_booth_ids } = req.body;
  if (!sales_order_id || !reason_code_id) {
    return res.status(400).json({ error: 'sales_order_id and reason_code_id are required.' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "A contract reduction must be based on the contract's actual line items — adjust the billing below first." });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const soResult = await client.query(
      `SELECT id, event_id, exhibitor_id, status, total_foreign, exchange_rate FROM sales_orders WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [sales_order_id, req.companyId]
    );
    const so = soResult.rows[0];
    if (!so) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Contract not found.' }); }
    if (so.status !== 'APPROVED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only an approved contract can be reduced.' });
    }
    const oldTotal = Number(so.total_foreign) || 0;

    const reasonCheck = await client.query(
      `SELECT id FROM cn_reason_codes WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [reason_code_id, req.companyId]
    );
    if (!reasonCheck.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid reason category.' });
    }

    const originalItemsResult = await client.query(
      `SELECT sales_item_code, description, category, qty, unit_price, discount_type, discount_value, tax_code_id
       FROM sales_order_items WHERE sales_order_id = $1 ORDER BY sort_order`,
      [sales_order_id]
    );

    const newTotal = await computeItemsTotal(client, req.companyId, items);
    if (!(newTotal < oldTotal - 0.001)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'The adjusted billing must total less than the current contract value — adjust an item down (qty, rate, or remove it).' });
    }

    let releasedBooths;
    try {
      releasedBooths = await validateReleasedBooths(client, req.companyId, sales_order_id, released_booth_ids);
    } catch (err) {
      await client.query('ROLLBACK');
      return res.status(err.status || 400).json({ error: err.message });
    }

    // Already-confirmed invoices are the floor this reduction has to
    // respect — anything the new total no longer covers needs a Credit
    // Note, never a silent rewrite of money already billed.
    const invoicedResult = await client.query(
      `SELECT COALESCE(SUM(amount_foreign), 0) AS total FROM invoices
       WHERE sales_order_id = $1 AND company_id = $2 AND status = 'CONFIRMED'`,
      [sales_order_id, req.companyId]
    );
    const alreadyIssued = Number(invoicedResult.rows[0].total);
    const exchangeRate = Number(so.exchange_rate) || 1;
    const cnAmountForeign = Math.max(0, alreadyIssued - newTotal);
    const cnAmountMyr = cnAmountForeign * exchangeRate;

    const result = await client.query(
      `INSERT INTO contract_reductions
         (company_id, event_id, sales_order_id, exhibitor_id, old_total_foreign, new_total_foreign,
          reason_code_id, notes, original_items, reduced_items, released_booth_ids,
          cn_amount_foreign, cn_amount_myr, status, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'PENDING_APPROVAL',$14)
       RETURNING id`,
      [
        req.companyId, so.event_id, sales_order_id, so.exhibitor_id, oldTotal, newTotal,
        reason_code_id, notes || null, JSON.stringify(originalItemsResult.rows), JSON.stringify(items), releasedBooths,
        cnAmountForeign, cnAmountMyr, req.userId,
      ]
    );

    await client.query(
      `INSERT INTO approval_log (sales_order_id, contract_reduction_id, action, actor_user_id, notes)
       VALUES ($1, $2, 'REDUCTION_REQUESTED', $3, $4)`,
      [
        sales_order_id, result.rows[0].id, req.userId,
        `Requested reduction from ${oldTotal.toFixed(2)} to ${newTotal.toFixed(2)} (${so.currency || ''})` +
          (cnAmountMyr > 0.01 ? ` — will need a RM${cnAmountMyr.toFixed(2)} credit note against an already-invoiced amount.` : '.'),
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({ contractReduction: { id: result.rows[0].id }, cn_amount_myr: cnAmountMyr });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Sales can edit a still-pending request — same validation as a fresh
// request, just updating the existing row in place.
async function updateContractReduction(req, res) {
  const { reason_code_id, notes, items, released_booth_ids } = req.body;
  if (!reason_code_id) return res.status(400).json({ error: 'reason_code_id is required.' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "A contract reduction must be based on the contract's actual line items — adjust the billing below first." });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const crResult = await client.query(`SELECT * FROM contract_reductions WHERE id = $1 AND company_id = $2 FOR UPDATE`, [req.params.id, req.companyId]);
    const cr = crResult.rows[0];
    if (!cr) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Contract reduction not found.' }); }
    if (cr.status !== 'PENDING_APPROVAL') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only a request still pending approval can be edited.' });
    }

    const soResult = await client.query(
      `SELECT total_foreign, exchange_rate, currency FROM sales_orders WHERE id = $1 AND company_id = $2`,
      [cr.sales_order_id, req.companyId]
    );
    const so = soResult.rows[0];
    const oldTotal = Number(so.total_foreign) || 0;

    const reasonCheck = await client.query(
      `SELECT id FROM cn_reason_codes WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [reason_code_id, req.companyId]
    );
    if (!reasonCheck.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid reason category.' });
    }

    const newTotal = await computeItemsTotal(client, req.companyId, items);
    if (!(newTotal < oldTotal - 0.001)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'The adjusted billing must total less than the current contract value — adjust an item down (qty, rate, or remove it).' });
    }

    let releasedBooths;
    try {
      releasedBooths = await validateReleasedBooths(client, req.companyId, cr.sales_order_id, released_booth_ids);
    } catch (err) {
      await client.query('ROLLBACK');
      return res.status(err.status || 400).json({ error: err.message });
    }

    const invoicedResult = await client.query(
      `SELECT COALESCE(SUM(amount_foreign), 0) AS total FROM invoices
       WHERE sales_order_id = $1 AND company_id = $2 AND status = 'CONFIRMED'`,
      [cr.sales_order_id, req.companyId]
    );
    const alreadyIssued = Number(invoicedResult.rows[0].total);
    const exchangeRate = Number(so.exchange_rate) || 1;
    const cnAmountForeign = Math.max(0, alreadyIssued - newTotal);
    const cnAmountMyr = cnAmountForeign * exchangeRate;

    await client.query(
      `UPDATE contract_reductions
       SET new_total_foreign = $1, reason_code_id = $2, notes = $3, reduced_items = $4, released_booth_ids = $5,
           cn_amount_foreign = $6, cn_amount_myr = $7
       WHERE id = $8`,
      [newTotal, reason_code_id, notes || null, JSON.stringify(items), releasedBooths, cnAmountForeign, cnAmountMyr, req.params.id]
    );

    await client.query(
      `INSERT INTO approval_log (sales_order_id, contract_reduction_id, action, actor_user_id, notes)
       VALUES ($1, $2, 'REDUCTION_REQUESTED', $3, $4)`,
      [cr.sales_order_id, req.params.id, req.userId, `Updated request — new total ${newTotal.toFixed(2)} (${so.currency || ''}).`]
    );

    await client.query('COMMIT');
    res.json({ success: true, cn_amount_myr: cnAmountMyr });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function deleteContractReduction(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const crResult = await client.query(
      `SELECT id, sales_order_id, new_total_foreign FROM contract_reductions WHERE id = $1 AND company_id = $2 AND status = 'PENDING_APPROVAL' FOR UPDATE`,
      [req.params.id, req.companyId]
    );
    const cr = crResult.rows[0];
    if (!cr) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only a request still pending approval can be withdrawn.' });
    }
    await client.query(
      `INSERT INTO approval_log (sales_order_id, contract_reduction_id, action, actor_user_id, notes)
       VALUES ($1, NULL, 'REDUCTION_WITHDRAWN', $2, $3)`,
      [cr.sales_order_id, req.userId, `Withdrew the reduction request (to ${Number(cr.new_total_foreign).toFixed(2)}).`]
    );
    await client.query(`DELETE FROM contract_reductions WHERE id = $1`, [req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function rejectContractReduction(req, res) {
  const crResult = await pool.query(
    `SELECT cr.id, cr.sales_order_id, cr.old_total_foreign, cr.new_total_foreign, cr.status, so.exchange_rate
     FROM contract_reductions cr JOIN sales_orders so ON so.id = cr.sales_order_id
     WHERE cr.id = $1 AND cr.company_id = $2`,
    [req.params.id, req.companyId]
  );
  const cr = crResult.rows[0];
  if (!cr) return res.status(404).json({ error: 'Contract reduction not found.' });
  if (cr.status !== 'PENDING_APPROVAL') return res.status(400).json({ error: 'This request is not pending approval.' });

  const reductionMyr = (Number(cr.old_total_foreign) - Number(cr.new_total_foreign)) * Number(cr.exchange_rate || 1);
  const tier = await getRequiredApprover(req.companyId, reductionMyr, 'CONTRACT_REDUCTION');
  if (!canActOnTier(req, tier)) {
    const who = tier ? (tier.approver_user_name || `the ${tier.approver_role_code} role`) : 'Admin/Management';
    return res.status(403).json({ error: `Only ${who} can reject this reduction.` });
  }

  await pool.query(
    `UPDATE contract_reductions SET status = 'REJECTED', rejection_notes = $1 WHERE id = $2`,
    [req.body.notes || null, req.params.id]
  );
  await pool.query(
    `INSERT INTO approval_log (sales_order_id, contract_reduction_id, action, actor_user_id, notes) VALUES ($1, $2, 'REDUCTION_REJECTED', $3, $4)`,
    [cr.sales_order_id, req.params.id, req.userId, req.body.notes || 'Rejected.']
  );
  res.json({ success: true });
}

// Approving does everything in one transaction, mirroring
// creditNotes.controller.js's approveCreditNote:
//   1. Releases whichever booths the request staged for release.
//   2. Replaces the contract's real sales_order_items with the request's
//      reduced_items snapshot, updates total_sqm to match Bare Space's new
//      qty, and recomputes the contract's totals.
// The shortfall Credit Note itself (cn_amount_myr, if any) is NOT created
// here — that's a separate action Sales takes afterward (see
// issueContractReductionCn), once they know which invoice should absorb
// it. Any not-yet-issued (SCHEDULED) milestone invoices are left for Sales
// to re-split by hand afterward too — not auto-rewritten here.
async function approveContractReduction(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const crResult = await client.query(`SELECT * FROM contract_reductions WHERE id = $1 AND company_id = $2 FOR UPDATE`, [req.params.id, req.companyId]);
    const cr = crResult.rows[0];
    if (!cr) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Contract reduction not found.' }); }
    if (cr.status !== 'PENDING_APPROVAL') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This request is not pending approval.' });
    }

    const soResult = await client.query(`SELECT * FROM sales_orders WHERE id = $1 AND company_id = $2 FOR UPDATE`, [cr.sales_order_id, req.companyId]);
    const so = soResult.rows[0];
    const exchangeRate = Number(so.exchange_rate) || 1;
    const reductionForeign = Number(cr.old_total_foreign) - Number(cr.new_total_foreign);
    const reductionMyr = reductionForeign * exchangeRate;

    const tier = await getRequiredApprover(req.companyId, reductionMyr, 'CONTRACT_REDUCTION');
    if (!canActOnTier(req, tier)) {
      await client.query('ROLLBACK');
      const who = tier ? (tier.approver_user_name || `the ${tier.approver_role_code} role`) : 'Admin/Management';
      return res.status(403).json({ error: `Only ${who} can approve this reduction (RM${reductionMyr.toLocaleString('en-MY', { minimumFractionDigits: 2 })}).` });
    }

    // 1. Release the staged booths — they go back to AVAILABLE, same
    // cleanup the item-based Credit Note flow already does.
    if (cr.released_booth_ids && cr.released_booth_ids.length > 0) {
      await client.query(
        `UPDATE floor_plan_booths
         SET status = 'AVAILABLE', sales_order_id = NULL, assigned_exhibitor_name = NULL, fascia_name = NULL
         WHERE id = ANY($1::uuid[])`,
        [cr.released_booth_ids]
      );
    }

    // 2. Replace the contract's real line items with the request's own
    // reduced_items snapshot — recomputing tax/discount server-side exactly
    // like addItem does, never trusting the client-submitted line_total.
    const reducedItems = cr.reduced_items || [];
    await client.query(`DELETE FROM sales_order_items WHERE sales_order_id = $1`, [cr.sales_order_id]);
    let sortOrder = 1;
    for (const item of reducedItems) {
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
          cr.sales_order_id, item.sales_item_code, item.description || null, item.category || 'OTHER',
          qtyNum, unitPriceNum, discountType, item.discount_value || null, item.tax_code_id || null, taxRatePct,
          subtotal, discountAmount, taxAmount, lineTotal, sortOrder++,
        ]
      );
    }

    // total_sqm always mirrors Bare Space's own qty.
    const basItem = reducedItems.find((it) => it.sales_item_code === 'BAS');
    await client.query(
      `UPDATE sales_orders SET total_sqm = $1 WHERE id = $2 AND company_id = $3`,
      [basItem ? Number(basItem.qty) || 0 : null, cr.sales_order_id, req.companyId]
    );

    const afterTotalMyr = await recomputeTotals(client, cr.sales_order_id, req.companyId);

    await client.query(`UPDATE contract_reductions SET status = 'APPROVED', approved_by = $1, approved_at = now() WHERE id = $2`, [req.userId, req.params.id]);

    await client.query(
      `INSERT INTO approval_log (sales_order_id, contract_reduction_id, action, actor_user_id, notes)
       VALUES ($1, $2, 'REDUCTION_APPROVED', $3, $4)`,
      [
        cr.sales_order_id, cr.id, req.userId,
        `Approved — contract reduced from ${Number(cr.old_total_foreign).toFixed(2)} to ${Number(cr.new_total_foreign).toFixed(2)} (RM${Number(afterTotalMyr).toFixed(2)})` +
          (Number(cr.cn_amount_myr) > 0.01 ? `; a RM${Number(cr.cn_amount_myr).toFixed(2)} credit note is now ready to be issued against an invoice.` : '.'),
      ]
    );

    await client.query('COMMIT');
    res.json({ success: true, cn_amount_myr: Number(cr.cn_amount_myr) || 0 });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Sales issues the pre-approved shortfall as a real Credit Note document,
// against whichever CONFIRMED invoice they pick — the amount itself was
// already fixed and approved as part of the Contract Reduction, so this
// step never asks for a fresh approval, only which invoice it applies to.
// Created straight into DRAFT (same stage a freshly-approved Credit Note
// would be at) — Finance still has to Confirm it (with an attachment)
// before it actually reduces that invoice's outstanding balance, same as
// any other Credit Note.
async function issueContractReductionCn(req, res) {
  const { invoice_id } = req.body;
  if (!invoice_id) return res.status(400).json({ error: 'invoice_id is required.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const crResult = await client.query(`SELECT * FROM contract_reductions WHERE id = $1 AND company_id = $2 FOR UPDATE`, [req.params.id, req.companyId]);
    const cr = crResult.rows[0];
    if (!cr) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Contract reduction not found.' }); }
    if (cr.status !== 'APPROVED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only an approved reduction can have its credit note issued.' });
    }
    if (cr.cn_issued_at) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'The credit note for this reduction has already been issued.' });
    }
    const amount = Number(cr.cn_amount_myr) || 0;
    if (!(amount > 0.01)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This reduction has no shortfall — no credit note is needed.' });
    }

    const invResult = await client.query(
      `SELECT id, amount_myr, status FROM invoices WHERE id = $1 AND sales_order_id = $2 AND company_id = $3`,
      [invoice_id, cr.sales_order_id, req.companyId]
    );
    const invoice = invResult.rows[0];
    if (!invoice) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Invoice not found on this contract.' }); }
    if (invoice.status !== 'CONFIRMED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Credit notes can only be issued against a confirmed invoice.' });
    }
    const committed = await committedCnTotal(client, invoice_id);
    if (amount > Number(invoice.amount_myr) - committed + 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `RM${amount.toFixed(2)} exceeds this invoice's remaining room for credit notes (RM${(Number(invoice.amount_myr) - committed).toFixed(2)} available) — pick a different invoice.`,
      });
    }

    const cnNo = await generateCnNo(client, req.companyId);
    const cnResult = await client.query(
      `INSERT INTO credit_notes
         (company_id, event_id, sales_order_id, exhibitor_id, invoice_id, amount_myr, reason, reason_code_id,
          original_items, adjusted_items, status, cn_no, cn_date, requested_by, approved_by, approved_at, contract_reduction_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'DRAFT',$11,CURRENT_DATE,$12,$13,now(),$14)
       RETURNING id`,
      [
        req.companyId, cr.event_id, cr.sales_order_id, cr.exhibitor_id, invoice_id, amount,
        cr.notes || 'Contract value reduction.', cr.reason_code_id,
        JSON.stringify(cr.original_items || []), JSON.stringify(cr.reduced_items || []), cnNo, cr.requested_by, req.userId, cr.id,
      ]
    );

    await client.query(`UPDATE contract_reductions SET cn_issued_at = now() WHERE id = $1`, [req.params.id]);

    await client.query(
      `INSERT INTO approval_log (sales_order_id, credit_note_id, contract_reduction_id, action, actor_user_id, notes)
       VALUES ($1, $2, $3, 'CN_APPROVED', $4, $5)`,
      [cr.sales_order_id, cnResult.rows[0].id, cr.id, req.userId, `Issued ${cnNo} — RM${amount.toFixed(2)} against invoice, from contract reduction.`]
    );

    await client.query('COMMIT');
    res.json({ success: true, cn_no: cnNo, credit_note_id: cnResult.rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  listContractReductions, getContractReduction, requestContractReduction, updateContractReduction, deleteContractReduction,
  approveContractReduction, rejectContractReduction, issueContractReductionCn,
};
