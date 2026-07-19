const { pool } = require('../config/db');
const { visibilityClause } = require('../utils/visibility');
const { checkNewContract } = require('../utils/approvalTriggers');

async function listSalesOrders(req, res) {
  const { event_id, search } = req.query;
  if (!event_id) {
    return res.status(400).json({ error: 'event_id is required.' });
  }

  const vis = visibilityClause(req, 'so.salesperson_id', 4);

  const result = await pool.query(
    `SELECT so.id, so.contract_type, so.contract_date, so.total_myr,
            ex.company_name AS exhibitor_name, u.full_name AS salesperson_name
     FROM sales_orders so
     JOIN exhibitors ex ON ex.id = so.exhibitor_id
     LEFT JOIN users u ON u.id = so.salesperson_id
     WHERE so.company_id = $1
       AND so.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
       AND so.is_active = TRUE
       AND ($3 = '' OR ex.company_name ILIKE '%' || $3 || '%')
       AND ${vis.sql}
     ORDER BY so.contract_date DESC NULLS LAST, ex.company_name`,
    [req.companyId, event_id, search || '', ...(vis.param !== undefined ? [vis.param] : [])]
  );

  res.json({ salesOrders: result.rows });
}

async function getSalesOrder(req, res) {
  const vis = visibilityClause(req, 'so.salesperson_id', 3);
  const result = await pool.query(
    `SELECT so.*,
            ex.company_name, ex.country_code, ex.contact1_name, ex.contact1_email, ex.contact1_phone,
            ex.postcode, ex.city, ex.reg_no, ex.tin_no, ex.sst_no,
            ex.billing_name, ex.billing_address, ex.billing_postcode, ex.billing_city,
            ex.billing_country_code, ex.billing_reg_no, ex.billing_tin_no, ex.billing_sst_no,
            ex.billing_contact_no, ex.billing_email, ex.billing_same_as_company,
            ev.name AS event_name,
            u.full_name AS salesperson_name,
            o.booth_sqm, o.booth_type
     FROM sales_orders so
     JOIN exhibitors ex ON ex.id = so.exhibitor_id
     JOIN events ev ON ev.id = so.event_id
     LEFT JOIN users u ON u.id = so.salesperson_id
     LEFT JOIN opportunities o ON o.id = so.opportunity_id
     WHERE so.id = $1 AND so.company_id = $2 AND ${vis.sql}`,
    [req.params.id, req.companyId, ...(vis.param !== undefined ? [vis.param] : [])]
  );

  const salesOrder = result.rows[0];
  if (!salesOrder) {
    return res.status(404).json({ error: 'Sales order not found.' });
  }

  res.json({ salesOrder });
}

async function createSalesOrder(req, res) {
  const { exhibitor_id, event_id, opportunity_id, salesperson_id, contract_type, contract_date, currency,
          hall, booth_no, dimension, booking_type, remarks } = req.body;

  if (!exhibitor_id || !event_id) {
    return res.status(400).json({ error: 'exhibitor_id and event_id are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Totals are no longer typed in — they're built up from line items after
    // creation. A new contract's exchange rate snapshots the company's
    // current default estimate (admin-configurable), used only until it's
    // actually invoiced — each invoice then carries Finance's real rate.
    const contractCurrency = currency || 'MYR';
    let exchangeRate = 1;
    if (contractCurrency !== 'MYR') {
      const settings = await client.query(
        `SELECT usd_to_myr_rate FROM company_settings WHERE company_id = $1`,
        [req.companyId]
      );
      exchangeRate = settings.rows[0] ? Number(settings.rows[0].usd_to_myr_rate) : 4;
    }

    const result = await client.query(
      `INSERT INTO sales_orders (company_id, exhibitor_id, event_id, opportunity_id, salesperson_id,
                                 contract_type, contract_date, currency, exchange_rate, total_myr, total_foreign,
                                 hall, booth_no, dimension, booking_type, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, 0, $10, $11, $12, $13, $14)
       RETURNING id`,
      [
        req.companyId, exhibitor_id, event_id, opportunity_id || null, salesperson_id || null,
        contract_type || 'STANDARD', contract_date || null, contractCurrency, exchangeRate,
        hall || null, booth_no || null, dimension || null, booking_type || null, remarks || null,
      ]
    );

    // If the company has a NEW_CONTRACT approval rule configured, this drops
    // the contract into PENDING_APPROVAL instead of the default APPROVED.
    await checkNewContract(client, req.companyId, result.rows[0].id, req.userId);

    // Signing a contract means the deal is won — move the source opportunity
    // to the company's "won" stage so the pipeline reflects it automatically.
    if (opportunity_id) {
      await client.query(
        `UPDATE opportunities SET stage_id = (
           SELECT id FROM sales_stages WHERE company_id = $1 AND is_won = TRUE LIMIT 1
         )
         WHERE id = $2 AND company_id = $1`,
        [req.companyId, opportunity_id]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ salesOrder: { id: result.rows[0].id } });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// total_myr/total_foreign are NOT editable here — they're derived from line
// items (see salesOrderItems.controller.js recomputeTotals). currency and
// exchange_rate remain editable so the contract's estimate rate can be
// corrected before it's invoiced.
const SALES_ORDER_FIELDS = ['contract_type', 'contract_date', 'currency', 'exchange_rate', 'hall', 'booth_no', 'dimension', 'booking_type', 'remarks'];

async function updateSalesOrder(req, res) {
  const fields = {};
  for (const field of SALES_ORDER_FIELDS) {
    if (field in req.body) fields[field] = req.body[field] === '' ? null : req.body[field];
  }
  const columns = Object.keys(fields);

  if (columns.length === 0) {
    return res.json({ salesOrder: { id: req.params.id } });
  }

  const setClause = columns.map((c, i) => `${c} = $${i + 3}`).join(', ');
  const result = await pool.query(
    `UPDATE sales_orders SET ${setClause}
     WHERE id = $1 AND company_id = $2
     RETURNING id`,
    [req.params.id, req.companyId, ...columns.map((c) => fields[c])]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: 'Sales order not found.' });
  }

  res.json({ salesOrder: { id: req.params.id } });
}

module.exports = { listSalesOrders, getSalesOrder, createSalesOrder, updateSalesOrder };
