const { pool } = require('../config/db');

async function listViews(req, res) {
  const { screen } = req.query;
  if (!screen) {
    return res.status(400).json({ error: 'screen is required.' });
  }
  const result = await pool.query(
    `SELECT id, name, columns, is_default FROM user_table_views
     WHERE user_id = $1 AND screen_key = $2
     ORDER BY name`,
    [req.userId, screen]
  );
  res.json({ views: result.rows });
}

async function createView(req, res) {
  const { screen_key, name, columns, is_default } = req.body;
  if (!screen_key || !name || !Array.isArray(columns)) {
    return res.status(400).json({ error: 'screen_key, name and columns are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (is_default) {
      await client.query(
        `UPDATE user_table_views SET is_default = FALSE WHERE user_id = $1 AND screen_key = $2`,
        [req.userId, screen_key]
      );
    }
    const result = await client.query(
      `INSERT INTO user_table_views (user_id, screen_key, name, columns, is_default)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, screen_key, name)
       DO UPDATE SET columns = EXCLUDED.columns, is_default = EXCLUDED.is_default
       RETURNING id`,
      [req.userId, screen_key, name, JSON.stringify(columns), !!is_default]
    );
    await client.query('COMMIT');
    res.status(201).json({ view: { id: result.rows[0].id } });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateView(req, res) {
  const { name, columns, is_default } = req.body;

  const existing = await pool.query(
    `SELECT screen_key FROM user_table_views WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.userId]
  );
  if (!existing.rows[0]) {
    return res.status(404).json({ error: 'View not found.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (is_default) {
      await client.query(
        `UPDATE user_table_views SET is_default = FALSE WHERE user_id = $1 AND screen_key = $2`,
        [req.userId, existing.rows[0].screen_key]
      );
    }
    const fields = {};
    if (name !== undefined) fields.name = name;
    if (columns !== undefined) fields.columns = JSON.stringify(columns);
    if (is_default !== undefined) fields.is_default = !!is_default;
    const cols = Object.keys(fields);
    if (cols.length > 0) {
      const setClause = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
      await client.query(
        `UPDATE user_table_views SET ${setClause} WHERE id = $1 AND user_id = $2`,
        [req.params.id, req.userId, ...cols.map((c) => fields[c])]
      );
    }
    await client.query('COMMIT');
    res.json({ view: { id: req.params.id } });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function deleteView(req, res) {
  const result = await pool.query(
    `DELETE FROM user_table_views WHERE id = $1 AND user_id = $2 RETURNING id`,
    [req.params.id, req.userId]
  );
  if (!result.rows[0]) {
    return res.status(404).json({ error: 'View not found.' });
  }
  res.json({ success: true });
}

module.exports = { listViews, createView, updateView, deleteView };
