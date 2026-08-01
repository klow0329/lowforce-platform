const { pool } = require('../config/db');
const { getRequiredApprover, canActOnTier } = require('../utils/approverMatrix');
const { recomputeTotals, calcLine } = require('./salesOrderItems.controller');
const { releaseClaim, promotePrimaryClaimants } = require('../utils/floorPlanClaims');
const { syncBoothFieldsAndMirror } = require('../utils/opportunitySync');
const { internalGenerateDraftInvoices } = require('./invoices.controller');

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
         so.legacy_order_no, so.salesperson_id, so.currency, so.exchange_rate,
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

// Same "who can actually act on this" computation the main Contract
// approval flow already exposes (getSalesOrder's requiredApprover/
// canApprove) — the Value Change table's Approve/Reject/Edit/Withdraw
// buttons used to render for ANY viewer regardless of role, and
// Edit/Withdraw had no server-side ownership check at all (2026-08-01 user
// report: "everyone can edit, approve, reject and view"). Approve/Reject
// were already correctly 403'd server-side (see approveContractReduction),
// but nothing told the FRONTEND not to show the button in the first place,
// and Edit/Withdraw had no gate whatsoever, client or server.
async function annotateApprovalInfo(req, rows) {
  for (const cr of rows) {
    cr.is_owner = cr.requested_by === req.userId;
    // Strictly the original requester — no department-wide bypass, even
    // Admin (2026-08-01 user instruction).
    cr.can_edit = cr.status === 'PENDING_APPROVAL' && cr.is_owner;
    if (cr.status !== 'PENDING_APPROVAL') {
      cr.can_approve = false;
      cr.required_approver_label = null;
      continue;
    }
    const reductionMyr = Math.abs(Number(cr.old_total_foreign) - Number(cr.new_total_foreign)) * (Number(cr.exchange_rate) || 1);
    const tier = await getRequiredApprover(req.companyId, reductionMyr, 'CONTRACT_REDUCTION', cr.event_id);
    cr.can_approve = canActOnTier(req, tier, cr.created_at);
    cr.required_approver_label = tier ? (tier.approver_user_name || `the ${tier.approver_role_code} role`) : 'Admin/Management';
  }
  return rows;
}

async function listContractReductions(req, res) {
  const { sales_order_id } = req.query;
  if (!sales_order_id) return res.status(400).json({ error: 'sales_order_id is required.' });
  const result = await pool.query(
    `${DETAIL_SELECT} WHERE cr.company_id = $1 AND cr.sales_order_id = $2 ORDER BY cr.created_at DESC`,
    [req.companyId, sales_order_id]
  );
  res.json({ contractReductions: await annotateApprovalInfo(req, result.rows) });
}

async function getContractReduction(req, res) {
  const result = await pool.query(`${DETAIL_SELECT} WHERE cr.id = $1 AND cr.company_id = $2`, [req.params.id, req.companyId]);
  const contractReduction = result.rows[0];
  if (!contractReduction) return res.status(404).json({ error: 'Contract reduction not found.' });
  await annotateApprovalInfo(req, [contractReduction]);
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

// Booths newly picked in the "Adjust Floor Plan Allocation" step that
// weren't already linked to this contract — soft-checked at request time
// (real booths, not already SOLD to someone else) so Sales gets fast
// feedback; re-checked authoritatively at approval time too (see
// approveContractReduction), since availability can change while the
// request sits pending.
async function validateAddedBooths(client, companyId, addedBoothIds) {
  if (!Array.isArray(addedBoothIds) || addedBoothIds.length === 0) return [];
  const result = await client.query(
    `SELECT b.id, b.status, so.status AS sales_order_status
     FROM floor_plan_booths b
     JOIN floor_plan_halls h ON h.id = b.hall_id
     LEFT JOIN sales_orders so ON so.id = b.sales_order_id
     WHERE h.company_id = $1 AND b.id = ANY($2::uuid[])`,
    [companyId, addedBoothIds]
  );
  if (result.rows.length !== addedBoothIds.length) {
    throw Object.assign(new Error('One or more selected booths no longer exist.'), { status: 400 });
  }
  const sold = result.rows.find((b) => b.sales_order_status === 'APPROVED');
  if (sold) throw Object.assign(new Error('One or more selected booths have already been sold to another contract.'), { status: 409 });
  const reserved = result.rows.find((b) => b.status === 'RESERVED');
  if (reserved) throw Object.assign(new Error('One or more selected booths are Reserved.'), { status: 409 });
  return addedBoothIds;
}

// Drops any key from the {boothId: code} map the picker returns that isn't
// a real booth in this company — the SPECIFIC standing (already linked to
// this contract vs. newly added) is validated separately by
// validateReleasedBooths/validateAddedBooths; this is just "is this id even
// a real booth", so a code for a newly-picked (not-yet-linked) booth isn't
// wrongly dropped here.
async function sanitizeBoothItemCodes(client, companyId, boothItemCodes) {
  if (!boothItemCodes || typeof boothItemCodes !== 'object') return {};
  const ids = Object.keys(boothItemCodes);
  if (ids.length === 0) return {};
  const result = await client.query(
    `SELECT b.id FROM floor_plan_booths b
     JOIN floor_plan_halls h ON h.id = b.hall_id
     WHERE h.company_id = $1 AND b.id = ANY($2::uuid[])`,
    [companyId, ids]
  );
  const validIds = new Set(result.rows.map((r) => r.id));
  const clean = {};
  for (const [boothId, code] of Object.entries(boothItemCodes)) {
    if (validIds.has(boothId) && code) clean[boothId] = code;
  }
  return clean;
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
  const { sales_order_id, reason_code_id, notes, items, released_booth_ids, booth_item_codes, added_booth_ids } = req.body;
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
    if (Math.abs(newTotal - oldTotal) < 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'The adjusted billing must actually change the contract value — adjust at least one item (qty, rate, or add/remove one).' });
    }

    let releasedBooths;
    let addedBooths;
    try {
      releasedBooths = await validateReleasedBooths(client, req.companyId, sales_order_id, released_booth_ids);
      addedBooths = await validateAddedBooths(client, req.companyId, added_booth_ids);
    } catch (err) {
      await client.query('ROLLBACK');
      return res.status(err.status || 400).json({ error: err.message });
    }
    const cleanBoothItemCodes = await sanitizeBoothItemCodes(client, req.companyId, booth_item_codes);

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
          reason_code_id, notes, original_items, reduced_items, released_booth_ids, booth_item_codes, added_booth_ids,
          cn_amount_foreign, cn_amount_myr, status, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'PENDING_APPROVAL',$16)
       RETURNING id`,
      [
        req.companyId, so.event_id, sales_order_id, so.exhibitor_id, oldTotal, newTotal,
        reason_code_id, notes || null, JSON.stringify(originalItemsResult.rows), JSON.stringify(items), releasedBooths,
        JSON.stringify(cleanBoothItemCodes), addedBooths, cnAmountForeign, cnAmountMyr, req.userId,
      ]
    );

    const isIncreaseReq = newTotal > oldTotal;
    await client.query(
      `INSERT INTO approval_log (sales_order_id, contract_reduction_id, action, actor_user_id, notes)
       VALUES ($1, $2, 'REDUCTION_REQUESTED', $3, $4)`,
      [
        sales_order_id, result.rows[0].id, req.userId,
        `Requested ${isIncreaseReq ? 'an increase' : 'a reduction'} from ${oldTotal.toFixed(2)} to ${newTotal.toFixed(2)} (${so.currency || ''})` +
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
  const { reason_code_id, notes, items, released_booth_ids, booth_item_codes, added_booth_ids } = req.body;
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
    // Previously unchecked — any logged-in user could edit anyone else's
    // pending request. Strictly the original requester, full stop — no
    // department-wide bypass, same as the main contract's own Submit/
    // Withdraw below (2026-08-01 user report/instruction: "only sales can
    // edit and withdrawn... no other department").
    if (cr.requested_by !== req.userId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only the person who requested this can edit it.' });
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
    if (Math.abs(newTotal - oldTotal) < 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'The adjusted billing must actually change the contract value — adjust at least one item (qty, rate, or add/remove one).' });
    }

    let releasedBooths;
    let addedBooths;
    try {
      releasedBooths = await validateReleasedBooths(client, req.companyId, cr.sales_order_id, released_booth_ids);
      addedBooths = await validateAddedBooths(client, req.companyId, added_booth_ids);
    } catch (err) {
      await client.query('ROLLBACK');
      return res.status(err.status || 400).json({ error: err.message });
    }
    const cleanBoothItemCodes = await sanitizeBoothItemCodes(client, req.companyId, booth_item_codes);

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
           booth_item_codes = $6, added_booth_ids = $7, cn_amount_foreign = $8, cn_amount_myr = $9
       WHERE id = $10`,
      [
        newTotal, reason_code_id, notes || null, JSON.stringify(items), releasedBooths,
        JSON.stringify(cleanBoothItemCodes), addedBooths, cnAmountForeign, cnAmountMyr, req.params.id,
      ]
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
      `SELECT id, sales_order_id, new_total_foreign, requested_by FROM contract_reductions WHERE id = $1 AND company_id = $2 AND status = 'PENDING_APPROVAL' FOR UPDATE`,
      [req.params.id, req.companyId]
    );
    const cr = crResult.rows[0];
    if (!cr) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only a request still pending approval can be withdrawn.' });
    }
    // Previously unchecked — any logged-in user could withdraw anyone
    // else's pending request. Strictly the original requester (2026-08-01
    // user instruction: "no other department").
    if (cr.requested_by !== req.userId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only the person who requested this can withdraw it.' });
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
    `SELECT cr.id, cr.sales_order_id, cr.old_total_foreign, cr.new_total_foreign, cr.status, cr.event_id, cr.created_at, so.exchange_rate
     FROM contract_reductions cr JOIN sales_orders so ON so.id = cr.sales_order_id
     WHERE cr.id = $1 AND cr.company_id = $2`,
    [req.params.id, req.companyId]
  );
  const cr = crResult.rows[0];
  if (!cr) return res.status(404).json({ error: 'Contract reduction not found.' });
  if (cr.status !== 'PENDING_APPROVAL') return res.status(400).json({ error: 'This request is not pending approval.' });

  // Tier lookup works off the magnitude of the change, not its direction —
  // an increase needs the same approval scrutiny as a decrease of the same
  // size (2026-08-01 item 4).
  const reductionMyr = Math.abs(Number(cr.old_total_foreign) - Number(cr.new_total_foreign)) * Number(cr.exchange_rate || 1);
  const tier = await getRequiredApprover(req.companyId, reductionMyr, 'CONTRACT_REDUCTION', cr.event_id);
  if (!canActOnTier(req, tier, cr.created_at)) {
    const who = tier ? (tier.approver_user_name || `the ${tier.approver_role_code} role`) : 'Admin/Management';
    return res.status(403).json({ error: `Only ${who} can reject this request.` });
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
    const isIncrease = Number(cr.new_total_foreign) > Number(cr.old_total_foreign);
    // Same magnitude-not-direction tier lookup as rejectContractReduction.
    const reductionMyr = Math.abs(Number(cr.old_total_foreign) - Number(cr.new_total_foreign)) * exchangeRate;

    const tier = await getRequiredApprover(req.companyId, reductionMyr, 'CONTRACT_REDUCTION', cr.event_id);
    if (!canActOnTier(req, tier, cr.created_at)) {
      await client.query('ROLLBACK');
      const who = tier ? (tier.approver_user_name || `the ${tier.approver_role_code} role`) : 'Admin/Management';
      return res.status(403).json({ error: `Only ${who} can approve this ${isIncrease ? 'increase' : 'reduction'} (RM${reductionMyr.toLocaleString('en-MY', { minimumFractionDigits: 2 })}).` });
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
      // The claim itself (floor_plan_booth_claims) is the real multi-claim
      // source of truth — clearing the booth's own columns above isn't
      // enough, or the booth still reads as actively claimed by this
      // contract everywhere that reads the claims table directly. Scoped to
      // just these released booths (not releaseAllClaims) since the
      // contract may still genuinely hold others.
      for (const boothId of cr.released_booth_ids) {
        await releaseClaim(client, boothId, 'sales_order', cr.sales_order_id, 'REDUCTION_APPROVED');
      }
    }

    const boothItemCodes = cr.booth_item_codes || {};
    const releasedSet = new Set(cr.released_booth_ids || []);
    const addedSet = new Set(cr.added_booth_ids || []);

    // 1b. Claim any newly-picked booths that weren't already linked to this
    // contract (2026-08-01: the booth adjuster is no longer release-only,
    // it can add/change/remove freely, same as the Opportunity/Contract
    // picker). Re-validated here, not just at request time, since
    // availability can change while the request sat pending — mirrors
    // bulkSetRecordBooths' own guard.
    if (addedSet.size > 0) {
      const addedIds = [...addedSet];
      const check = await client.query(
        `SELECT b.id, b.status, so.status AS sales_order_status
         FROM floor_plan_booths b
         JOIN floor_plan_halls h ON h.id = b.hall_id
         LEFT JOIN sales_orders so ON so.id = b.sales_order_id
         WHERE h.company_id = $1 AND b.id = ANY($2::uuid[])`,
        [req.companyId, addedIds]
      );
      const conflict = check.rows.find((b) => b.sales_order_status === 'APPROVED' || b.status === 'RESERVED');
      if (conflict) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'One or more newly added booths have since been sold or reserved by someone else — please re-open this request and adjust the selection.' });
      }
      await client.query(
        `INSERT INTO floor_plan_booth_claims (company_id, booth_id, record_type, record_id, allocated_item_code)
         SELECT $1, x.id, 'sales_order', $2, $4::jsonb ->> x.id::text FROM unnest($3::uuid[]) AS x(id)
         ON CONFLICT (booth_id, record_type, record_id) WHERE released_at IS NULL
         DO UPDATE SET allocated_item_code = EXCLUDED.allocated_item_code`,
        [req.companyId, cr.sales_order_id, addedIds, JSON.stringify(boothItemCodes)]
      );
      await promotePrimaryClaimants(client, addedIds);
    }

    // 1c. Apply any type re-tag (Bare Space -> Corner, etc.) the "Adjust
    // Floor Plan Allocation" picker captured for whichever SURVIVING booths
    // (not released, not newly added — those are already handled above)
    // had their type changed — this is what actually makes the picker's
    // type dropdown (2026-08-01 fix) mean something, instead of only ever
    // affecting the local display.
    const retagIds = Object.keys(boothItemCodes).filter((bid) => !releasedSet.has(bid) && !addedSet.has(bid));
    if (retagIds.length > 0) {
      for (const boothId of retagIds) {
        await client.query(
          `UPDATE floor_plan_booth_claims SET allocated_item_code = $1
           WHERE booth_id = $2 AND record_type = 'sales_order' AND record_id = $3 AND released_at IS NULL`,
          [boothItemCodes[boothId], boothId, cr.sales_order_id]
        );
      }
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

    const afterTotalMyr = await recomputeTotals(client, cr.sales_order_id, req.companyId);

    // Re-derive Hall/Booth No/Total Sqm from the claims released above — the
    // single source of truth for those fields — then mirror everything onto
    // the linked Opportunity in the same transaction so reopening it never
    // shows stale pre-reduction data (2026-07-31 user request). This used to
    // set total_sqm from the reduced BAS item's qty directly, a second
    // computation independent of the claims table that could disagree with
    // it and never touched hall/booth_no at all — unified 2026-08-01.
    await syncBoothFieldsAndMirror(client, req.companyId, 'sales_order', cr.sales_order_id);

    // An increase that comes AFTER an invoice already exists on this
    // contract needs a new invoice for the additional value — same
    // draft-then-Finance-confirm flow as any other invoice, not a manual
    // step (2026-08-01 item 4: "add another invoice for the addition
    // value, follow the same process as set for invoicing part"). Skipped
    // when nothing has been invoiced yet — the increase is just part of
    // what Sales will invoice normally whenever they're ready. Reuses
    // generateDraftInvoices' own "remaining = contract total - already
    // invoiced" math (now against the just-recomputed higher total), so
    // there's one definition of "remaining" for the whole app, not two.
    let autoInvoice = null;
    if (isIncrease) {
      const existingInvoiceCount = await client.query(
        `SELECT COUNT(*)::int AS n FROM invoices WHERE sales_order_id = $1 AND company_id = $2`,
        [cr.sales_order_id, req.companyId]
      );
      if (existingInvoiceCount.rows[0].n > 0) {
        try {
          const created = await internalGenerateDraftInvoices(client, req.companyId, cr.sales_order_id, null);
          autoInvoice = created[0] || null;
        } catch (invErr) {
          // "Already fully invoiced" (e.g. the increase rounds to nothing
          // new) is a benign no-op here, not a reason to fail the whole
          // approval — anything else (a real DB error) should still abort
          // the transaction via the outer catch.
          if (invErr.status !== 400) throw invErr;
        }
      }
    }

    await client.query(`UPDATE contract_reductions SET status = 'APPROVED', approved_by = $1, approved_at = now() WHERE id = $2`, [req.userId, req.params.id]);

    await client.query(
      `INSERT INTO approval_log (sales_order_id, contract_reduction_id, action, actor_user_id, notes)
       VALUES ($1, $2, 'REDUCTION_APPROVED', $3, $4)`,
      [
        cr.sales_order_id, cr.id, req.userId,
        `Approved — contract ${isIncrease ? 'increased' : 'reduced'} from ${Number(cr.old_total_foreign).toFixed(2)} to ${Number(cr.new_total_foreign).toFixed(2)} (RM${Number(afterTotalMyr).toFixed(2)})` +
          (Number(cr.cn_amount_myr) > 0.01 ? `; a RM${Number(cr.cn_amount_myr).toFixed(2)} credit note is now ready to be issued against an invoice.` : '') +
          (autoInvoice ? `; a new draft invoice ${autoInvoice.invoice_no ? autoInvoice.invoice_no : '(scheduled)'} was created for the additional value.` : '') + '.',
      ]
    );

    await client.query('COMMIT');
    res.json({ success: true, cn_amount_myr: Number(cr.cn_amount_myr) || 0, auto_invoice: autoInvoice });
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

// Lets the requester clear the "your Value Change was approved/rejected"
// Task To-Do item — mirrors approvals.controller.js's acknowledgeApproval
// for the main contract flow exactly (2026-08-01: this notification step
// didn't exist at all before, since a resolved reduction never touches
// sales_orders.status the way the original approval does).
async function acknowledgeReductionApproval(req, res) {
  const result = await pool.query(
    `UPDATE contract_reductions SET approval_acknowledged_by = $1, approval_acknowledged_at = now()
     WHERE id = $2 AND company_id = $3 RETURNING id`,
    [req.userId, req.params.id, req.companyId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Contract reduction not found.' });
  res.json({ success: true });
}

module.exports = {
  listContractReductions, getContractReduction, requestContractReduction, updateContractReduction, deleteContractReduction,
  approveContractReduction, rejectContractReduction, issueContractReductionCn, acknowledgeReductionApproval,
};
