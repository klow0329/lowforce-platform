const { pool } = require('../config/db');
const { checkDiscount, checkPostApprovalEdit, checkRevenueThreshold } = require('../utils/approvalTriggers');

// Server always recomputes the money — never trust a client-submitted total.
// total_foreign stays in the contract's own currency (what "un-invoiced
// balance" is checked against); *_myr columns are that total converted at
// the contract's estimate rate, for pipeline valuation/reporting only.
function calcLine({ qty, unit_price, discount_type, discount_value, tax_rate_pct }) {
  const subtotal = Number(qty) * Number(unit_price);
  let discountAmount = 0;
  if (discount_type === 'PERCENT') discountAmount = subtotal * (Number(discount_value) || 0) / 100;
  else if (discount_type === 'FLAT') discountAmount = Number(discount_value) || 0;
  const taxableBase = subtotal - discountAmount;
  const taxAmount = taxableBase * (Number(tax_rate_pct) || 0) / 100;
  const lineTotal = taxableBase + taxAmount;
  return { subtotal, discountAmount, taxAmount, lineTotal };
}

async function recomputeTotals(client, salesOrderId, companyId) {
  const so = (await client.query(
    `SELECT exchange_rate FROM sales_orders WHERE id = $1 AND company_id = $2`,
    [salesOrderId, companyId]
  )).rows[0];
  const rate = Number(so.exchange_rate) || 1;

  const totals = (await client.query(
    `SELECT COALESCE(SUM(subtotal - discount_amount), 0) AS net_subtotal,
            COALESCE(SUM(tax_amount), 0) AS tax_total,
            COALESCE(SUM(line_total), 0) AS grand_total
     FROM sales_order_items WHERE sales_order_id = $1`,
    [salesOrderId]
  )).rows[0];

  const totalMyr = Number(totals.grand_total) * rate;
  await client.query(
    `UPDATE sales_orders
     SET total_foreign = $1, subtotal_myr = $2, tax_total_myr = $3, total_myr = $4
     WHERE id = $5 AND company_id = $6`,
    [
      totals.grand_total,
      Number(totals.net_subtotal) * rate,
      Number(totals.tax_total) * rate,
      totalMyr,
      salesOrderId, companyId,
    ]
  );
  return totalMyr;
}

async function listItems(req, res) {
  const result = await pool.query(
    `SELECT soi.*, tc.code AS tax_code
     FROM sales_order_items soi
     LEFT JOIN tax_codes tc ON tc.id = soi.tax_code_id
     WHERE soi.sales_order_id = $1
     ORDER BY soi.sort_order, soi.id`,
    [req.params.id]
  );
  res.json({ items: result.rows });
}

async function addItem(req, res) {
  const {
    price_list_id, sales_item_code, description, category,
    qty, unit_price, discount_type, discount_value, tax_code_id,
  } = req.body;

  if (!sales_item_code || qty === undefined || unit_price === undefined) {
    return res.status(400).json({ error: 'sales_item_code, qty and unit_price are required.' });
  }
  // qty/unit_price are NOT NULL numeric columns — a row can be checked in
  // the UI before the Price List has a rate for it, which sends ''. Coerce
  // rather than let that hit the database as an invalid numeric literal.
  const qtyNum = Number(qty) || 0;
  const unitPriceNum = Number(unit_price) || 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const soCheck = await client.query(
      `SELECT id, status FROM sales_orders WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.companyId]
    );
    if (!soCheck.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Contract not found.' });
    }
    const wasApproved = soCheck.rows[0].status === 'APPROVED';

    let taxRatePct = 0;
    if (tax_code_id) {
      const tc = await client.query(
        `SELECT rate_pct FROM tax_codes WHERE id = $1 AND company_id = $2`,
        [tax_code_id, req.companyId]
      );
      taxRatePct = tc.rows[0] ? Number(tc.rows[0].rate_pct) : 0;
    }

    const { subtotal, discountAmount, taxAmount, lineTotal } = calcLine({
      qty: qtyNum, unit_price: unitPriceNum, discount_type, discount_value, tax_rate_pct: taxRatePct,
    });

    const sortResult = await client.query(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM sales_order_items WHERE sales_order_id = $1`,
      [req.params.id]
    );

    const result = await client.query(
      `INSERT INTO sales_order_items
         (sales_order_id, price_list_id, sales_item_code, description, category, qty, unit_price,
          discount_type, discount_value, tax_code_id, tax_rate_pct, subtotal, discount_amount, tax_amount, line_total, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [
        req.params.id, price_list_id || null, sales_item_code, description || null, category || 'OTHER',
        qtyNum, unitPriceNum, discount_type || null, discount_value || null, tax_code_id || null, taxRatePct,
        subtotal, discountAmount, taxAmount, lineTotal, sortResult.rows[0].next,
      ]
    );

    const totalMyr = await recomputeTotals(client, req.params.id, req.companyId);

    const discountFlagged = await checkDiscount(
      client, req.companyId, req.params.id, discount_type, discount_value, subtotal, req.userId
    );
    if (!discountFlagged) {
      await checkPostApprovalEdit(client, req.companyId, req.params.id, wasApproved, req.userId);
    }
    // Revenue threshold is about the contract's absolute value, independent
    // of why this particular line changed — always checked, not gated
    // behind the discount/post-approval-edit flags above.
    await checkRevenueThreshold(client, req.companyId, req.params.id, totalMyr, req.userId);

    await client.query('COMMIT');
    res.status(201).json({ item: { id: result.rows[0].id } });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateItem(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT soi.*, so.company_id, so.status AS so_status
       FROM sales_order_items soi
       JOIN sales_orders so ON so.id = soi.sales_order_id
       WHERE soi.id = $1 AND soi.sales_order_id = $2 AND so.company_id = $3`,
      [req.params.itemId, req.params.id, req.companyId]
    );
    const item = existing.rows[0];
    if (!item) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Line item not found.' });
    }
    const wasApproved = item.so_status === 'APPROVED';

    const merged = {
      qty: Number(req.body.qty !== undefined ? req.body.qty : item.qty) || 0,
      unit_price: Number(req.body.unit_price !== undefined ? req.body.unit_price : item.unit_price) || 0,
      discount_type: 'discount_type' in req.body ? req.body.discount_type : item.discount_type,
      discount_value: 'discount_value' in req.body ? req.body.discount_value : item.discount_value,
      tax_code_id: 'tax_code_id' in req.body ? req.body.tax_code_id : item.tax_code_id,
      description: 'description' in req.body ? req.body.description : item.description,
      sales_item_code: req.body.sales_item_code || item.sales_item_code,
      category: req.body.category || item.category,
    };

    let taxRatePct = 0;
    if (merged.tax_code_id) {
      const tc = await client.query(
        `SELECT rate_pct FROM tax_codes WHERE id = $1 AND company_id = $2`,
        [merged.tax_code_id, req.companyId]
      );
      taxRatePct = tc.rows[0] ? Number(tc.rows[0].rate_pct) : 0;
    }

    const { subtotal, discountAmount, taxAmount, lineTotal } = calcLine({
      qty: merged.qty, unit_price: merged.unit_price,
      discount_type: merged.discount_type, discount_value: merged.discount_value,
      tax_rate_pct: taxRatePct,
    });

    await client.query(
      `UPDATE sales_order_items
       SET sales_item_code = $1, description = $2, category = $3, qty = $4, unit_price = $5,
           discount_type = $6, discount_value = $7, tax_code_id = $8, tax_rate_pct = $9,
           subtotal = $10, discount_amount = $11, tax_amount = $12, line_total = $13
       WHERE id = $14`,
      [
        merged.sales_item_code, merged.description, merged.category, merged.qty, merged.unit_price,
        merged.discount_type, merged.discount_value, merged.tax_code_id, taxRatePct,
        subtotal, discountAmount, taxAmount, lineTotal, req.params.itemId,
      ]
    );

    const totalMyr = await recomputeTotals(client, req.params.id, req.companyId);

    const flagged = await checkDiscount(
      client, req.companyId, req.params.id, merged.discount_type, merged.discount_value, subtotal, req.userId
    );
    if (!flagged) {
      // Covers every other kind of change to an already-approved contract —
      // including a tax code change, which used to be its own separate
      // trigger but is really just one flavour of "edited after approval".
      await checkPostApprovalEdit(client, req.companyId, req.params.id, wasApproved, req.userId);
    }
    await checkRevenueThreshold(client, req.companyId, req.params.id, totalMyr, req.userId);

    await client.query('COMMIT');
    res.json({ item: { id: req.params.itemId } });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function deleteItem(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `DELETE FROM sales_order_items
       WHERE id = $1 AND sales_order_id = $2
         AND sales_order_id IN (SELECT id FROM sales_orders WHERE company_id = $3)
       RETURNING id`,
      [req.params.itemId, req.params.id, req.companyId]
    );
    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Line item not found.' });
    }

    await recomputeTotals(client, req.params.id, req.companyId);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { listItems, addItem, updateItem, deleteItem };
