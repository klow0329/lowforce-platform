const { pool } = require('../config/db');

// Resolves one credit_term_line into an actual calendar date — shared by the
// scheduled-invoice pre-fill and (in principle) anything else that needs
// "when is this installment due". *_AFTER_SIGNING resolves against the
// contract's own contract_date; *_BEFORE_EVENT resolves against the event's
// start_date instead, so the same named Credit Term (e.g. "50% due 3 months
// before event") carries over correctly from one event cycle to the next
// without Sales having to re-type a fixed date each time (2026-08-01 user
// request).
function resolveLineDueDate(line, signingDate, eventStartDate) {
  if (line.basis_type === 'FIXED_DATE') return line.basis_date;
  const n = Number(line.basis_value) || 0;
  if (line.basis_type.endsWith('_BEFORE_EVENT')) {
    if (!eventStartDate) return null;
    const d = new Date(eventStartDate);
    if (line.basis_type === 'DAYS_BEFORE_EVENT') d.setDate(d.getDate() - n);
    else if (line.basis_type === 'WEEKS_BEFORE_EVENT') d.setDate(d.getDate() - n * 7);
    else if (line.basis_type === 'MONTHS_BEFORE_EVENT') d.setMonth(d.getMonth() - n);
    return d.toISOString().slice(0, 10);
  }
  if (!signingDate) return null;
  const d = new Date(signingDate);
  if (line.basis_type === 'DAYS_AFTER_SIGNING') d.setDate(d.getDate() + n);
  else if (line.basis_type === 'WEEKS_AFTER_SIGNING') d.setDate(d.getDate() + n * 7);
  else if (line.basis_type === 'MONTHS_AFTER_SIGNING') d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

async function listCreditTerms(req, res) {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required.' });

  const terms = await pool.query(
    `SELECT id, code, name, default_for_tier, is_active, sort_order
     FROM credit_terms WHERE company_id = $1 AND event_id = $2
     ORDER BY sort_order, name`,
    [req.companyId, event_id]
  );
  if (terms.rows.length === 0) return res.json({ creditTerms: [] });

  const lines = await pool.query(
    `SELECT id, credit_term_id, sort_order, pct, basis_type, basis_date, basis_value, description
     FROM credit_term_lines WHERE credit_term_id = ANY($1::uuid[])
     ORDER BY sort_order`,
    [terms.rows.map((t) => t.id)]
  );
  const byTerm = {};
  for (const l of lines.rows) (byTerm[l.credit_term_id] ||= []).push(l);

  res.json({ creditTerms: terms.rows.map((t) => ({ ...t, lines: byTerm[t.id] || [] })) });
}

async function createCreditTerm(req, res) {
  const { event_id, code, name, default_for_tier, is_active, sort_order, lines } = req.body;
  if (!event_id || !code || !name) {
    return res.status(400).json({ error: 'event_id, code and name are required.' });
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'At least one installment line is required.' });
  }
  const totalPct = lines.reduce((sum, l) => sum + (Number(l.pct) || 0), 0);
  if (Math.abs(totalPct - 100) > 0.01) {
    return res.status(400).json({ error: `Installment percentages must add up to exactly 100% (currently ${totalPct}%).` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO credit_terms (company_id, event_id, code, name, default_for_tier, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [req.companyId, event_id, code, name, default_for_tier || null, is_active !== false, sort_order || 0]
    );
    const termId = result.rows[0].id;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await client.query(
        `INSERT INTO credit_term_lines (credit_term_id, sort_order, pct, basis_type, basis_date, basis_value, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [termId, i, l.pct, l.basis_type, l.basis_date || null, l.basis_value || null, l.description || null]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ creditTerm: { id: termId } });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: `Credit term code ${code} already exists for this event.` });
    throw err;
  } finally {
    client.release();
  }
}

async function updateCreditTerm(req, res) {
  const { code, name, default_for_tier, is_active, sort_order, lines } = req.body;
  if (Array.isArray(lines) && lines.length > 0) {
    const totalPct = lines.reduce((sum, l) => sum + (Number(l.pct) || 0), 0);
    if (Math.abs(totalPct - 100) > 0.01) {
      return res.status(400).json({ error: `Installment percentages must add up to exactly 100% (currently ${totalPct}%).` });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const fields = {};
    for (const [k, v] of Object.entries({ code, name, default_for_tier, is_active, sort_order })) {
      if (v !== undefined) fields[k] = v === '' ? null : v;
    }
    const columns = Object.keys(fields);
    if (columns.length > 0) {
      const setClause = columns.map((c, i) => `${c} = $${i + 3}`).join(', ');
      const result = await client.query(
        `UPDATE credit_terms SET ${setClause} WHERE id = $1 AND company_id = $2 RETURNING id`,
        [req.params.id, req.companyId, ...columns.map((c) => fields[c])]
      );
      if (!result.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Credit term not found.' });
      }
    }

    if (Array.isArray(lines)) {
      await client.query(`DELETE FROM credit_term_lines WHERE credit_term_id = $1`, [req.params.id]);
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        await client.query(
          `INSERT INTO credit_term_lines (credit_term_id, sort_order, pct, basis_type, basis_date, basis_value, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [req.params.id, i, l.pct, l.basis_type, l.basis_date || null, l.basis_value || null, l.description || null]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ creditTerm: { id: req.params.id } });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'That credit term code already exists for this event.' });
    throw err;
  } finally {
    client.release();
  }
}

async function deleteCreditTerm(req, res) {
  const result = await pool.query(
    `DELETE FROM credit_terms WHERE id = $1 AND company_id = $2 RETURNING id`,
    [req.params.id, req.companyId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Credit term not found.' });
  res.json({ success: true });
}

// Used by the Generate Scheduled Invoices screen to pre-fill splits from a
// contract's selected Credit Terms, resolved against that contract's own
// contract_date as the "signing date" anchor.
async function resolveCreditTermForContract(req, res) {
  const so = await pool.query(
    `SELECT so.credit_terms_id, so.contract_date, ev.start_date AS event_start_date
     FROM sales_orders so JOIN events ev ON ev.id = so.event_id
     WHERE so.id = $1 AND so.company_id = $2`,
    [req.params.salesOrderId, req.companyId]
  );
  if (!so.rows[0]) return res.status(404).json({ error: 'Contract not found.' });
  if (!so.rows[0].credit_terms_id) return res.json({ splits: null });

  const lines = await pool.query(
    `SELECT pct, basis_type, basis_date, basis_value FROM credit_term_lines
     WHERE credit_term_id = $1 ORDER BY sort_order`,
    [so.rows[0].credit_terms_id]
  );
  const splits = lines.rows.map((l) => ({
    pct: Number(l.pct),
    expected_billing_date: resolveLineDueDate(l, so.rows[0].contract_date, so.rows[0].event_start_date) || '',
  }));
  res.json({ splits });
}

module.exports = {
  listCreditTerms, createCreditTerm, updateCreditTerm, deleteCreditTerm, resolveCreditTermForContract, resolveLineDueDate,
};
