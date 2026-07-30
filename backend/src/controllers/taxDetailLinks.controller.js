const crypto = require('crypto');
const { pool } = require('../config/db');
const { recordAudit } = require('../utils/auditLog');

const LINK_LIFETIME_DAYS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Sales/Admin generates a link (needs a real session — see routes) to send
// the exhibitor via their own email client, so the exhibitor can fill in
// tax/registration details LowForce never made them provide up front.
async function createLink(req, res) {
  const { exhibitor_id } = req.body;
  if (!exhibitor_id) return res.status(400).json({ error: 'exhibitor_id is required.' });

  const exhibitor = await pool.query(
    `SELECT id, company_name, contact1_email FROM exhibitors WHERE id = $1 AND company_id = $2`,
    [exhibitor_id, req.companyId]
  );
  if (!exhibitor.rows[0]) return res.status(404).json({ error: 'Exhibitor not found.' });

  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO tax_detail_links (company_id, exhibitor_id, token, created_by, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '${LINK_LIFETIME_DAYS} days')`,
    [req.companyId, exhibitor_id, token, req.userId]
  );

  res.status(201).json({
    token,
    url: `${req.protocol}://${req.get('host')}/tax-details/${token}`,
    expiresInDays: LINK_LIFETIME_DAYS,
    exhibitorEmail: exhibitor.rows[0].contact1_email || '',
    exhibitorName: exhibitor.rows[0].company_name,
  });
}

// PUBLIC — no login. The token itself (long, random, single-use, time-
// limited) is the only thing standing between this and anyone on the
// internet, same as a password-reset link. Only ever returns/accepts the
// narrow set of fields the exhibitor is being asked to fill in — never
// anything that could touch billing status, ownership, or any other
// company's data.
async function getLinkInfo(req, res) {
  const link = await pool.query(
    `SELECT tdl.exhibitor_id, tdl.company_id, tdl.expires_at, tdl.used_at, ex.company_name, ex.country_code
     FROM tax_detail_links tdl
     JOIN exhibitors ex ON ex.id = tdl.exhibitor_id
     WHERE tdl.token = $1`,
    [req.params.token]
  );
  const row = link.rows[0];
  if (!row) return res.status(404).json({ error: 'This link is invalid.' });
  if (row.used_at) return res.status(410).json({ error: 'This link has already been used.' });
  if (new Date(row.expires_at) < new Date()) return res.status(410).json({ error: 'This link has expired — ask your LowForce contact to send a new one.' });

  // Segment is nice-to-have context Sales often doesn't have yet this early
  // in the deal — offered here as optional, not required, same reasoning as
  // the tax fields themselves.
  const segmentsResult = await pool.query(
    `SELECT sm.id AS main_id, sm.name AS main_name, ss.id AS sub_id, ss.name AS sub_name
     FROM segment_main sm
     LEFT JOIN segment_sub ss ON ss.segment_main_id = sm.id AND ss.company_id = sm.company_id
     WHERE sm.company_id = $1
     ORDER BY sm.name, ss.name`,
    [row.company_id]
  );
  const mains = new Map();
  for (const r of segmentsResult.rows) {
    if (!mains.has(r.main_id)) mains.set(r.main_id, { id: r.main_id, name: r.main_name, subSegments: [] });
    if (r.sub_id) mains.get(r.main_id).subSegments.push({ id: r.sub_id, name: r.sub_name });
  }

  res.json({ companyName: row.company_name, countryCode: row.country_code, segments: Array.from(mains.values()) });
}

async function submitLink(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const link = await client.query(
      `SELECT id, company_id, exhibitor_id, expires_at, used_at FROM tax_detail_links WHERE token = $1 FOR UPDATE`,
      [req.params.token]
    );
    const row = link.rows[0];
    if (!row) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'This link is invalid.' }); }
    if (row.used_at) { await client.query('ROLLBACK'); return res.status(410).json({ error: 'This link has already been used.' }); }
    if (new Date(row.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'This link has expired — ask your LowForce contact to send a new one.' });
    }

    const { company_name, reg_no, tin_no, address, postcode, city, state, email, contact_no, segment_main_id, segment_sub_id } = req.body;
    if (!company_name || !address || !email || !contact_no) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Company Name, Address, Email and Contact No. are required.' });
    }
    if (!EMAIL_RE.test(email.trim())) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'That email address doesn\'t look valid.' });
    }
    const digitsOnly = contact_no.replace(/\D/g, '');
    if (!digitsOnly) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Contact No. must contain digits (country code first, e.g. 60123456789).' });
    }

    // Same normalization convention as the in-app Exhibitor form — text
    // fields trimmed and uppercased, email lowercased, phone digits-only.
    await client.query(
      `UPDATE exhibitors SET
         company_name = $1, reg_no = $2, tin_no = $3, address = $4,
         postcode = $5, city = $6, state = $7, contact1_email = $8, contact1_phone = $9
       WHERE id = $10 AND company_id = $11`,
      [
        company_name.trim().toUpperCase(), (reg_no || '').trim() || null, (tin_no || '').trim() || null, address.trim().toUpperCase(),
        (postcode || '').trim().replace(/\D/g, '') || null, (city || '').trim().toUpperCase() || null, (state || '').trim().toUpperCase() || null,
        email.trim().toLowerCase(), digitsOnly, row.exhibitor_id, row.company_id,
      ]
    );
    // Segment is optional and additive-only here — if Sales has already
    // assigned one or more, an exhibitor's own self-service submission
    // never overwrites that internally-managed classification.
    if (segment_main_id) {
      const existing = await client.query(
        `SELECT 1 FROM exhibitor_segments WHERE exhibitor_id = $1 LIMIT 1`,
        [row.exhibitor_id]
      );
      if (!existing.rows[0]) {
        const validMain = await client.query(
          `SELECT id FROM segment_main WHERE id = $1 AND company_id = $2`,
          [segment_main_id, row.company_id]
        );
        if (validMain.rows[0]) {
          let validSubId = null;
          if (segment_sub_id) {
            const validSub = await client.query(
              `SELECT id FROM segment_sub WHERE id = $1 AND segment_main_id = $2 AND company_id = $3`,
              [segment_sub_id, segment_main_id, row.company_id]
            );
            if (validSub.rows[0]) validSubId = validSub.rows[0].id;
          }
          await client.query(
            `INSERT INTO exhibitor_segments (exhibitor_id, segment_main_id, segment_sub_id) VALUES ($1, $2, $3)`,
            [row.exhibitor_id, segment_main_id, validSubId]
          );
        }
      }
    }

    await client.query(`UPDATE tax_detail_links SET used_at = now() WHERE id = $1`, [row.id]);

    await client.query('COMMIT');

    // No session on a public endpoint, so this bypasses the normal
    // audit middleware entirely — logged explicitly here instead, since a
    // write to real exhibitor data from an unauthenticated form is exactly
    // the kind of action that must never go unlogged.
    recordAudit({
      companyId: row.company_id,
      userId: null,
      userName: 'Exhibitor self-service (tax detail link)',
      roleCode: null,
      action: 'POST',
      entityType: 'exhibitors',
      entityId: row.exhibitor_id,
      details: { path: `/tax-details/${req.params.token}`, body: { company_name, reg_no, tin_no, address, postcode, city, state, email, contact_no } },
    });

    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createLink, getLinkInfo, submitLink };
