const { pool } = require('../config/db');

// Every query in here filters by req.companyId (set by middleware/tenant.js).
// This is the pattern every other Phase 1 module (opportunities, sales
// orders, invoices...) should follow.
async function listExhibitors(req, res) {
  const search = req.query.search || '';

  const result = await pool.query(
    `SELECT id, company_name, country_code, contact1_name, contact1_email, is_active
     FROM exhibitors
     WHERE company_id = $1
       AND is_active = TRUE
       AND company_name ILIKE $2
     ORDER BY company_name
     LIMIT 200`,
    [req.companyId, `%${search}%`]
  );

  res.json({ exhibitors: result.rows });
}

const EXHIBITOR_FIELDS = [
  'company_name', 'company_name_chinese', 'country_code', 'agent_id', 'salesperson_id',
  'address', 'postcode', 'city', 'state',
  'reg_no', 'tin_no', 'sst_no', 'website', 'fax', 'halal_certified',
  'contact1_name', 'contact1_job_title', 'contact1_phone', 'contact1_email',
  'contact2_name', 'contact2_job_title', 'contact2_phone', 'contact2_email',
  'billing_same_as_company', 'billing_name', 'billing_address',
  'billing_country_code', 'billing_email',
];

function pickExhibitorFields(body) {
  const out = {};
  for (const field of EXHIBITOR_FIELDS) {
    if (field in body) out[field] = body[field] === '' ? null : body[field];
  }
  return out;
}

async function getExhibitor(req, res) {
  const exhibitorResult = await pool.query(
    `SELECT * FROM exhibitors WHERE id = $1 AND company_id = $2`,
    [req.params.id, req.companyId]
  );
  const exhibitor = exhibitorResult.rows[0];
  if (!exhibitor) {
    return res.status(404).json({ error: 'Exhibitor not found.' });
  }

  const segmentsResult = await pool.query(
    `SELECT es.segment_sub_id
     FROM exhibitor_segments es
     WHERE es.exhibitor_id = $1`,
    [exhibitor.id]
  );

  res.json({
    exhibitor: { ...exhibitor, segment_sub_ids: segmentsResult.rows.map((r) => r.segment_sub_id) },
  });
}

async function createExhibitor(req, res) {
  const fields = pickExhibitorFields(req.body);

  if (!fields.company_name) {
    return res.status(400).json({ error: 'company_name is required.' });
  }

  const columns = Object.keys(fields);
  const placeholders = columns.map((_, i) => `$${i + 2}`);

  const result = await pool.query(
    `INSERT INTO exhibitors (company_id, ${columns.join(', ')})
     VALUES ($1, ${placeholders.join(', ')})
     RETURNING id`,
    [req.companyId, ...columns.map((c) => fields[c])]
  );

  const exhibitorId = result.rows[0].id;
  await replaceSegments(exhibitorId, req.body.segment_sub_ids);

  res.status(201).json({ exhibitor: { id: exhibitorId } });
}

async function updateExhibitor(req, res) {
  const fields = pickExhibitorFields(req.body);
  const columns = Object.keys(fields);

  if (columns.length > 0) {
    const setClause = columns.map((c, i) => `${c} = $${i + 3}`).join(', ');
    const result = await pool.query(
      `UPDATE exhibitors SET ${setClause}
       WHERE id = $1 AND company_id = $2
       RETURNING id`,
      [req.params.id, req.companyId, ...columns.map((c) => fields[c])]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Exhibitor not found.' });
    }
  }

  if ('segment_sub_ids' in req.body) {
    await replaceSegments(req.params.id, req.body.segment_sub_ids);
  }

  res.json({ exhibitor: { id: req.params.id } });
}

// Replaces the full segment set for an exhibitor in one go — simpler than
// granular add/remove endpoints, and the child table has no fixed cap
// (unlike the old 6-column hack), so any number of segments is fine.
async function replaceSegments(exhibitorId, segmentSubIds) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM exhibitor_segments WHERE exhibitor_id = $1`, [exhibitorId]);
    for (const segmentSubId of segmentSubIds || []) {
      await client.query(
        `INSERT INTO exhibitor_segments (exhibitor_id, segment_sub_id) VALUES ($1, $2)`,
        [exhibitorId, segmentSubId]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { listExhibitors, getExhibitor, createExhibitor, updateExhibitor };
