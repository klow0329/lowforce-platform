const { pool } = require('../config/db');
const { visibilityClause, financeVisibilityClause } = require('../utils/visibility');

// A real append-only history ("action + feedback" notes) shared by the
// Opportunity list's "Latest Correspondence" column and AR Aging's
// Correspondence column (see migration 039) — same table, same visibility
// rules as whichever parent record the note is attached to.
const ENTITY_TYPES = ['opportunity', 'invoice'];

async function canAccessEntity(req, entityType, entityId) {
  if (entityType === 'opportunity') {
    const vis = visibilityClause(req, 'o.salesperson_id', 3);
    const r = await pool.query(
      `SELECT 1 FROM opportunities o WHERE o.id = $1 AND o.company_id = $2 AND ${vis.sql}`,
      [entityId, req.companyId, ...(vis.param !== undefined ? [vis.param] : [])]
    );
    return !!r.rows[0];
  }
  if (entityType === 'invoice') {
    const vis = financeVisibilityClause(req, 'so.salesperson_id', 3);
    const r = await pool.query(
      `SELECT 1 FROM invoices inv JOIN sales_orders so ON so.id = inv.sales_order_id
       WHERE inv.id = $1 AND inv.company_id = $2 AND ${vis.sql}`,
      [entityId, req.companyId, ...(vis.param !== undefined ? [vis.param] : [])]
    );
    return !!r.rows[0];
  }
  return false;
}

async function listEntries(req, res) {
  const { entity_type, entity_id } = req.query;
  if (!ENTITY_TYPES.includes(entity_type) || !entity_id) {
    return res.status(400).json({ error: 'A valid entity_type and entity_id are required.' });
  }
  if (!(await canAccessEntity(req, entity_type, entity_id))) {
    return res.status(404).json({ error: 'Not found.' });
  }
  const result = await pool.query(
    `SELECT c.id, c.note, c.created_at, u.full_name AS created_by_name,
            c.edited_at, eu.full_name AS edited_by_name
     FROM correspondence_entries c
     LEFT JOIN users u ON u.id = c.created_by
     LEFT JOIN users eu ON eu.id = c.edited_by
     WHERE c.company_id = $1 AND c.entity_type = $2 AND c.entity_id = $3
     ORDER BY c.created_at DESC`,
    [req.companyId, entity_type, entity_id]
  );
  res.json({ entries: result.rows });
}

async function addEntry(req, res) {
  const { entity_type, entity_id, note } = req.body;
  if (!ENTITY_TYPES.includes(entity_type) || !entity_id) {
    return res.status(400).json({ error: 'A valid entity_type and entity_id are required.' });
  }
  if (!note || !note.trim()) {
    return res.status(400).json({ error: 'Note cannot be empty.' });
  }
  if (!(await canAccessEntity(req, entity_type, entity_id))) {
    return res.status(404).json({ error: 'Not found.' });
  }
  const result = await pool.query(
    `INSERT INTO correspondence_entries (company_id, entity_type, entity_id, note, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, note, created_at`,
    [req.companyId, entity_type, entity_id, note.trim(), req.userId]
  );
  res.status(201).json({ entry: result.rows[0] });
}

// Typos happen — lets the author (or anyone who could add a note here) fix
// an existing entry's text rather than leaving it wrong forever, while
// keeping the log accountable via edited_by/edited_at rather than silently
// mutating history.
async function updateEntry(req, res) {
  const { note } = req.body;
  if (!note || !note.trim()) {
    return res.status(400).json({ error: 'Note cannot be empty.' });
  }
  const existing = await pool.query(
    `SELECT entity_type, entity_id FROM correspondence_entries WHERE id = $1 AND company_id = $2`,
    [req.params.id, req.companyId]
  );
  if (!existing.rows[0]) return res.status(404).json({ error: 'Entry not found.' });
  if (!(await canAccessEntity(req, existing.rows[0].entity_type, existing.rows[0].entity_id))) {
    return res.status(404).json({ error: 'Not found.' });
  }
  const result = await pool.query(
    `UPDATE correspondence_entries SET note = $1, edited_by = $2, edited_at = now()
     WHERE id = $3 RETURNING id, note, created_at, edited_at`,
    [note.trim(), req.userId, req.params.id]
  );
  res.json({ entry: result.rows[0] });
}

module.exports = { listEntries, addEntry, updateEntry };
