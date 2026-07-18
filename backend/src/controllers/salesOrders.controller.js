const { pool } = require('../config/db');

async function listSalesOrders(req, res) {
  const { event_id, search } = req.query;
  if (!event_id) {
    return res.status(400).json({ error: 'event_id is required.' });
  }

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
     ORDER BY so.contract_date DESC NULLS LAST, ex.company_name`,
    [req.companyId, event_id, search || '']
  );

  res.json({ salesOrders: result.rows });
}

async function getSalesOrder(req, res) {
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
     WHERE so.id = $1 AND so.company_id = $2`,
    [req.params.id, req.companyId]
  );

  const salesOrder = result.rows[0];
  if (!salesOrder) {
    return res.status(404).json({ error: 'Sales order not found.' });
  }

  res.json({ salesOrder });
}

async function createSalesOrder(req, res) {
  const { exhibitor_id, event_id, opportunity_id, salesperson_id, contract_type, contract_date, total_myr,
          hall, booth_no, dimension, booking_type, remarks, discount_type, discount_value } = req.body;

  if (!exhibitor_id || !event_id) {
    return res.status(400).json({ error: 'exhibitor_id and event_id are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO sales_orders (company_id, exhibitor_id, event_id, opportunity_id, salesperson_id,
                                 contract_type, contract_date, total_myr, hall, booth_no, dimension, booking_type, remarks,
                                 discount_type, discount_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id`,
      [
        req.companyId, exhibitor_id, event_id, opportunity_id || null, salesperson_id || null,
        contract_type || 'STANDARD', contract_date || null, total_myr || 0,
        hall || null, booth_no || null, dimension || null, booking_type || null, remarks || null,
        discount_type || null, discount_value || null,
      ]
    );

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

const SALES_ORDER_FIELDS = ['contract_type', 'contract_date', 'total_myr', 'hall', 'booth_no', 'dimension', 'booking_type', 'remarks', 'discount_type', 'discount_value'];

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
