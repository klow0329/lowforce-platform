const { pool } = require('../config/db');

// Price list is event-scoped: each event carries its own rates (booth_type
// holds the rate tier — PUBLISHED RATE / EARLY BIRD / ONSITE REBOOKING /
// CONTRA — and sales_item_code the chargeable item, mirroring the Excel
// LIST sheet). Everyone with event access can view; only admins edit.
async function listPriceList(req, res) {
  const { event_id } = req.query;
  if (!event_id) {
    return res.status(400).json({ error: 'event_id is required.' });
  }

  const result = await pool.query(
    `SELECT pl.id, pl.booth_type, pl.sales_item_code, pl.description, pl.category,
            pl.unit_price_myr, pl.unit_price_usd, pl.default_tax_code_id,
            pl.is_upgrade_option, pl.is_addon_item, pl.pricing_mode, pl.pricing_pct, pl.is_wide_row,
            tc.code AS default_tax_code
     FROM price_list pl
     LEFT JOIN tax_codes tc ON tc.id = pl.default_tax_code_id
     WHERE pl.company_id = $1 AND pl.event_id = $2
     ORDER BY pl.booth_type, pl.sales_item_code`,
    [req.companyId, event_id]
  );

  res.json({ priceList: result.rows });
}

async function createPriceItem(req, res) {
  const {
    event_id, booth_type, sales_item_code, description, category, unit_price_myr, unit_price_usd, default_tax_code_id,
    is_upgrade_option, is_addon_item, pricing_mode, pricing_pct, is_wide_row,
  } = req.body;

  if (!event_id || !booth_type || !sales_item_code) {
    return res.status(400).json({ error: 'event_id, booth_type and sales_item_code are required.' });
  }

  const result = await pool.query(
    `INSERT INTO price_list (
       company_id, event_id, booth_type, sales_item_code, description, category, unit_price_myr, unit_price_usd, default_tax_code_id,
       is_upgrade_option, is_addon_item, pricing_mode, pricing_pct, is_wide_row
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [req.companyId, event_id, booth_type, sales_item_code,
     description || null, category || 'OTHER', unit_price_myr || null, unit_price_usd || null, default_tax_code_id || null,
     !!is_upgrade_option, !!is_addon_item, pricing_mode || 'FIXED', pricing_pct || null, !!is_wide_row]
  );

  res.status(201).json({ priceItem: { id: result.rows[0].id } });
}

async function updatePriceItem(req, res) {
  const fields = {};
  for (const field of [
    'booth_type', 'sales_item_code', 'description', 'category', 'unit_price_myr', 'unit_price_usd', 'default_tax_code_id',
    'is_upgrade_option', 'is_addon_item', 'pricing_mode', 'pricing_pct', 'is_wide_row',
  ]) {
    if (field in req.body) fields[field] = req.body[field] === '' ? null : req.body[field];
  }
  const columns = Object.keys(fields);

  if (columns.length === 0) {
    return res.json({ priceItem: { id: req.params.id } });
  }

  const setClause = columns.map((c, i) => `${c} = $${i + 3}`).join(', ');
  const result = await pool.query(
    `UPDATE price_list SET ${setClause}
     WHERE id = $1 AND company_id = $2
     RETURNING id`,
    [req.params.id, req.companyId, ...columns.map((c) => fields[c])]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: 'Price item not found.' });
  }

  res.json({ priceItem: { id: req.params.id } });
}

async function deletePriceItem(req, res) {
  const result = await pool.query(
    `DELETE FROM price_list WHERE id = $1 AND company_id = $2 RETURNING id`,
    [req.params.id, req.companyId]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: 'Price item not found.' });
  }

  res.json({ success: true });
}

module.exports = { listPriceList, createPriceItem, updatePriceItem, deletePriceItem };
