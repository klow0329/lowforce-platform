const { pool } = require('../config/db');

// Same fixed-template billing calc as sales_order_items — see
// salesOrderItems.controller.js for the contract-side twin of this file.
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

// estimated_value_myr becomes server-computed once items exist — same
// relationship as sales_orders.total_myr to its line items.
async function recomputeTotals(client, opportunityId, companyId) {
  const totals = (await client.query(
    `SELECT COALESCE(SUM(line_total), 0) AS grand_total
     FROM opportunity_items WHERE opportunity_id = $1`,
    [opportunityId]
  )).rows[0];

  await client.query(
    `UPDATE opportunities SET total_foreign = $1, estimated_value_myr = $2
     WHERE id = $3 AND company_id = $4`,
    [totals.grand_total, totals.grand_total, opportunityId, companyId]
  );
}

async function listItems(req, res) {
  const result = await pool.query(
    `SELECT oi.*, tc.code AS tax_code
     FROM opportunity_items oi
     LEFT JOIN tax_codes tc ON tc.id = oi.tax_code_id
     WHERE oi.opportunity_id = $1
     ORDER BY oi.sort_order, oi.id`,
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

    const oppCheck = await client.query(
      `SELECT id FROM opportunities WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.companyId]
    );
    if (!oppCheck.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Opportunity not found.' });
    }

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
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM opportunity_items WHERE opportunity_id = $1`,
      [req.params.id]
    );

    const result = await client.query(
      `INSERT INTO opportunity_items
         (opportunity_id, price_list_id, sales_item_code, description, category, qty, unit_price,
          discount_type, discount_value, tax_code_id, tax_rate_pct, subtotal, discount_amount, tax_amount, line_total, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [
        req.params.id, price_list_id || null, sales_item_code, description || null, category || 'OTHER',
        qtyNum, unitPriceNum, discount_type || null, discount_value || null, tax_code_id || null, taxRatePct,
        subtotal, discountAmount, taxAmount, lineTotal, sortResult.rows[0].next,
      ]
    );

    await recomputeTotals(client, req.params.id, req.companyId);
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
      `SELECT oi.*, o.company_id
       FROM opportunity_items oi
       JOIN opportunities o ON o.id = oi.opportunity_id
       WHERE oi.id = $1 AND oi.opportunity_id = $2 AND o.company_id = $3`,
      [req.params.itemId, req.params.id, req.companyId]
    );
    const item = existing.rows[0];
    if (!item) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Line item not found.' });
    }

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
      `UPDATE opportunity_items
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

    await recomputeTotals(client, req.params.id, req.companyId);
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
      `DELETE FROM opportunity_items
       WHERE id = $1 AND opportunity_id = $2
         AND opportunity_id IN (SELECT id FROM opportunities WHERE company_id = $3)
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
