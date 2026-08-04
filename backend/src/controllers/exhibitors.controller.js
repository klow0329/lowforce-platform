const { pool } = require('../config/db');
const { getAccessibleEventIds } = require('../middleware/eventAccess');
const { visibilityClause } = require('../utils/visibility');
const { cleanText, cleanLower, cleanKeepCase, cleanDigits } = require('../utils/importNormalize');

// Every query in here filters by req.companyId (set by middleware/tenant.js).
// This is the pattern every other Phase 1 module (opportunities, sales
// orders, invoices...) should follow.
async function listExhibitors(req, res) {
  const search = req.query.search || '';
  // Browsing with no search term still respects the normal own+unclaimed
  // visibility (keeps each rep's list focused/private day to day) — but the
  // moment there's a search term, every matching exhibitor company-wide is
  // returned (with its owner's name) so Sales can catch a duplicate before
  // creating one, instead of a same-name account under another rep being
  // invisible and silently re-created.
  const vis = search ? { sql: 'TRUE', param: undefined } : visibilityClause(req, 'e.salesperson_id', 3);

  const result = await pool.query(
    `SELECT e.id, e.company_name, e.country_code, e.contact1_name, e.contact1_email, e.is_active, e.salesperson_id,
            u.full_name AS salesperson_name
     FROM exhibitors e
     LEFT JOIN users u ON u.id = e.salesperson_id
     WHERE e.company_id = $1
       AND e.is_active = TRUE
       AND e.company_name ILIKE $2
       AND ${vis.sql}
     ORDER BY e.company_name
     LIMIT 200`,
    [req.companyId, `%${search}%`, ...(vis.param !== undefined ? [vis.param] : [])]
  );

  res.json({ exhibitors: result.rows });
}

const EXHIBITOR_FIELDS = [
  'company_name', 'company_name_alt', 'country_code', 'agent_id', 'salesperson_id',
  'address', 'postcode', 'city', 'state',
  'reg_no', 'tin_no', 'sst_no', 'website', 'fax', 'halal_certified',
  'contact1_name', 'contact1_job_title', 'contact1_phone', 'contact1_email',
  'contact2_name', 'contact2_job_title', 'contact2_phone', 'contact2_email',
  'billing_same_as_company', 'billing_exhibitor_id', 'billing_name', 'billing_address',
  'billing_postcode', 'billing_city', 'billing_country_code',
  'billing_reg_no', 'billing_tin_no', 'billing_sst_no', 'billing_contact_no',
  'billing_email', 'is_repeat_exhibitor',
];

function pickExhibitorFields(body) {
  const out = {};
  for (const field of EXHIBITOR_FIELDS) {
    if (field in body) out[field] = body[field] === '' ? null : body[field];
  }
  return out;
}

// When Billing is set to "select from Exhibitor list" (billing_exhibitor_id),
// the linked exhibitor's own company info is copied into the billing_* text
// columns — the same materialize-at-save pattern "Same as Exhibitor Info"
// already uses, just sourced from a different exhibitor's row instead of the
// exhibitor's own fields. Keeps every existing reader of billing_* (invoices,
// print pages, statements) working unchanged instead of needing a join.
async function applyBillingExhibitorLink(fields, companyId) {
  if (!fields.billing_exhibitor_id) return fields;
  const linked = await pool.query(
    `SELECT company_name, address, postcode, city, country_code, reg_no, tin_no, sst_no,
            contact1_phone, contact1_email
     FROM exhibitors WHERE id = $1 AND company_id = $2`,
    [fields.billing_exhibitor_id, companyId]
  );
  if (!linked.rows[0]) return null;
  const l = linked.rows[0];
  return {
    ...fields,
    billing_same_as_company: false,
    billing_name: l.company_name,
    billing_address: l.address,
    billing_postcode: l.postcode,
    billing_city: l.city,
    billing_country_code: l.country_code,
    billing_reg_no: l.reg_no,
    billing_tin_no: l.tin_no,
    billing_sst_no: l.sst_no,
    billing_contact_no: l.contact1_phone,
    billing_email: l.contact1_email,
  };
}

async function getExhibitor(req, res) {
  const vis = visibilityClause(req, 'ex.salesperson_id', 3);
  const exhibitorResult = await pool.query(
    `SELECT ex.*, ag.name AS agent_name, be.company_name AS billing_exhibitor_name
     FROM exhibitors ex
     LEFT JOIN agents ag ON ag.id = ex.agent_id
     LEFT JOIN exhibitors be ON be.id = ex.billing_exhibitor_id
     WHERE ex.id = $1 AND ex.company_id = $2 AND ${vis.sql}`,
    [req.params.id, req.companyId, ...(vis.param !== undefined ? [vis.param] : [])]
  );
  const exhibitor = exhibitorResult.rows[0];
  if (!exhibitor) {
    return res.status(404).json({ error: 'Exhibitor not found.' });
  }

  const segmentsResult = await pool.query(
    `SELECT segment_main_id, segment_sub_id, remarks
     FROM exhibitor_segments WHERE exhibitor_id = $1`,
    [exhibitor.id]
  );
  const eventsResult = await pool.query(
    `SELECT event_id FROM exhibitor_events WHERE exhibitor_id = $1`,
    [exhibitor.id]
  );

  res.json({
    exhibitor: {
      ...exhibitor,
      segments: segmentsResult.rows,
      event_ids: eventsResult.rows.map((r) => r.event_id),
    },
  });
}

async function createExhibitor(req, res) {
  let fields = pickExhibitorFields(req.body);

  if (!fields.company_name) {
    return res.status(400).json({ error: 'company_name is required.' });
  }
  if (fields.billing_exhibitor_id) {
    fields = await applyBillingExhibitorLink(fields, req.companyId);
    if (!fields) return res.status(400).json({ error: 'Selected billing company not found.' });
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
  await replaceSegments(exhibitorId, req.body.segments);
  if ('event_ids' in req.body) {
    await replaceEventParticipation(exhibitorId, req.body.event_ids, req.userId, req.companyId);
  }

  res.status(201).json({ exhibitor: { id: exhibitorId } });
}

async function updateExhibitor(req, res) {
  let fields = pickExhibitorFields(req.body);
  if (fields.billing_exhibitor_id) {
    fields = await applyBillingExhibitorLink(fields, req.companyId);
    if (!fields) return res.status(400).json({ error: 'Selected billing company not found.' });
  }
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

  if ('segments' in req.body) {
    await replaceSegments(req.params.id, req.body.segments);
  }
  if ('event_ids' in req.body) {
    await replaceEventParticipation(req.params.id, req.body.event_ids, req.userId, req.companyId);
  }

  res.json({ exhibitor: { id: req.params.id } });
}

// Replaces the full segment set — each entry is a main category (required),
// an optional subcategory, and optional remarks, matching the Excel's
// MAIN/SUB/REMARKS triplets but without the 6-slot cap.
async function replaceSegments(exhibitorId, segments) {
  if (!Array.isArray(segments)) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM exhibitor_segments WHERE exhibitor_id = $1`, [exhibitorId]);
    for (const seg of segments) {
      if (!seg || !seg.segment_main_id) continue;
      await client.query(
        `INSERT INTO exhibitor_segments (exhibitor_id, segment_main_id, segment_sub_id, remarks)
         VALUES ($1, $2, $3, $4)`,
        [exhibitorId, seg.segment_main_id, seg.segment_sub_id || null, seg.remarks || null]
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

// Replaces event participation, but only within the events this user can
// see — participation in events outside their access is left untouched, so
// a sales user can't silently wipe a sub-event they don't work on.
async function replaceEventParticipation(exhibitorId, eventIds, userId, companyId) {
  if (!Array.isArray(eventIds)) return;
  const accessible = await getAccessibleEventIds(userId, companyId);
  const allowed = eventIds.filter((id) => accessible.includes(id));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM exhibitor_events WHERE exhibitor_id = $1 AND event_id = ANY($2)`,
      [exhibitorId, accessible]
    );
    for (const eventId of allowed) {
      await client.query(
        `INSERT INTO exhibitor_events (exhibitor_id, event_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [exhibitorId, eventId]
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

// Bulk-flags exhibitors as repeat-from-last-year — rows already parsed
// client-side from the uploaded Excel/CSV (see Admin.jsx, same pattern as
// importSegments), each just { company_name }. Matched case/whitespace-
// insensitively against this company's current exhibitors; anyone not
// matched stays is_repeat_exhibitor = FALSE (the default), and a match can
// always be corrected by hand afterward on the Exhibitor's own record.
// Feeds the Agent Commission report's repeat-vs-new rate split.
async function importRepeatExhibitors(req, res) {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (rows.length === 0) return res.status(400).json({ error: 'No rows to import.' });

  const names = [...new Set(
    rows.map((r) => (r.company_name || '').toString().trim().toUpperCase()).filter(Boolean)
  )];
  if (names.length === 0) return res.status(400).json({ error: 'No company names found in that file.' });

  const result = await pool.query(
    `UPDATE exhibitors SET is_repeat_exhibitor = TRUE
     WHERE company_id = $1 AND UPPER(TRIM(company_name)) = ANY($2::text[])
     RETURNING company_name`,
    [req.companyId, names]
  );
  const matchedNames = new Set(result.rows.map((r) => r.company_name.trim().toUpperCase()));
  const unmatched = names.filter((n) => !matchedNames.has(n));

  res.json({
    success: true, namesInFile: names.length, matched: result.rows.length, unmatched,
  });
}

// Bulk add/update potential exhibitors from a directory/lead list (e.g. a
// batch of companies scraped or exported from an industry directory) — a
// full record creation, not just the repeat-flag import above. Matched by
// UPPER(TRIM(company_name)) within this company; an existing exhibitor gets
// its other fields updated (never deleted/overwritten to blank — a column
// missing from a given row is left untouched), a new name gets created.
// Every field here is optional except Company Name — a directory import
// often only has a name and country at first, with the rest filled in
// later once the lead is actually contacted (matches how the individual
// New Exhibitor form only hard-requires company_name server-side; the
// other "required" markers there are a data-entry nudge, not a DB rule).
const IMPORT_EXHIBITOR_FIELDS = [
  'company_name_alt', 'country_code', 'address', 'postcode', 'city', 'state',
  'reg_no', 'tin_no', 'sst_no', 'website', 'fax',
  'contact1_name', 'contact1_job_title', 'contact1_phone', 'contact1_email',
  'contact2_name', 'contact2_job_title', 'contact2_phone', 'contact2_email',
];

// Per-field cleanup on the way in — trimmed + uppercased by default (matches
// the manual New Exhibitor form's own convention), except: phone numbers
// (digits only, no + / spaces / dashes — see importNormalize.js), emails
// (trimmed + lowercased), and website (trimmed only, casing left alone since
// it's a URL).
const DIGITS_FIELDS = new Set(['postcode', 'contact1_phone', 'contact2_phone']);
const LOWER_FIELDS = new Set(['contact1_email', 'contact2_email']);
const KEEP_CASE_FIELDS = new Set(['website']);
function cleanImportField(field, value) {
  if (DIGITS_FIELDS.has(field)) return cleanDigits(value);
  if (LOWER_FIELDS.has(field)) return cleanLower(value);
  if (KEEP_CASE_FIELDS.has(field)) return cleanKeepCase(value);
  return cleanText(value);
}

async function importExhibitors(req, res) {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (rows.length === 0) return res.status(400).json({ error: 'No rows to import.' });

  let created = 0;
  let updated = 0;
  const skipped = [];

  for (const row of rows) {
    const companyName = cleanText(row.company_name);
    if (!companyName) continue;

    let salespersonId = null;
    const salespersonEmail = cleanLower(row.salesperson_email);
    if (salespersonEmail) {
      const u = await pool.query(
        `SELECT id FROM users WHERE company_id = $1 AND LOWER(email) = LOWER($2)`,
        [req.companyId, salespersonEmail]
      );
      if (u.rows[0]) salespersonId = u.rows[0].id;
      else skipped.push(`${companyName}: salesperson email "${salespersonEmail}" not found (exhibitor still saved, unassigned)`);
    }

    let agentId = null;
    const agentName = cleanText(row.agent_name);
    if (agentName) {
      const a = await pool.query(
        `SELECT id FROM agents WHERE company_id = $1 AND UPPER(TRIM(name)) = $2`,
        [req.companyId, agentName]
      );
      if (a.rows[0]) agentId = a.rows[0].id;
      else skipped.push(`${companyName}: agent "${agentName}" not found (exhibitor still saved, unassigned)`);
    }

    // Billed-through-another-exhibitor link, matched by name — same
    // resolve-by-name pattern as agent/salesperson above. The referenced
    // company must already exist (either from earlier in this same file,
    // processed sequentially, or already in the system) since the link
    // stores an id, not a name.
    let billingExhibitorId = null;
    const billingCompanyName = cleanText(row.billing_company_name);
    if (billingCompanyName) {
      const b = await pool.query(
        `SELECT id FROM exhibitors WHERE company_id = $1 AND UPPER(TRIM(company_name)) = $2`,
        [req.companyId, billingCompanyName]
      );
      if (b.rows[0]) billingExhibitorId = b.rows[0].id;
      else skipped.push(`${companyName}: billing company "${billingCompanyName}" not found (exhibitor still saved, billed to itself)`);
    }

    let fields = {};
    for (const f of IMPORT_EXHIBITOR_FIELDS) {
      if (row[f]) {
        const cleaned = cleanImportField(f, row[f]);
        if (cleaned) fields[f] = cleaned;
      }
    }
    if (salespersonId) fields.salesperson_id = salespersonId;
    if (agentId) fields.agent_id = agentId;
    if (billingExhibitorId) {
      fields.billing_exhibitor_id = billingExhibitorId;
      fields = await applyBillingExhibitorLink(fields, req.companyId);
    }

    const existing = await pool.query(
      `SELECT id FROM exhibitors WHERE company_id = $1 AND UPPER(TRIM(company_name)) = $2`,
      [req.companyId, companyName]
    );
    const cols = Object.keys(fields);
    let exhibitorId;
    if (existing.rows[0]) {
      if (cols.length > 0) {
        const setClause = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
        await pool.query(
          `UPDATE exhibitors SET ${setClause} WHERE id = $1 AND company_id = $2`,
          [existing.rows[0].id, req.companyId, ...cols.map((c) => fields[c])]
        );
      }
      exhibitorId = existing.rows[0].id;
      updated += 1;
    } else {
      const insertCols = ['company_id', 'company_name', ...cols];
      const placeholders = insertCols.map((_, i) => `$${i + 1}`);
      const inserted = await pool.query(
        `INSERT INTO exhibitors (${insertCols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
        [req.companyId, companyName, ...cols.map((c) => fields[c])]
      );
      exhibitorId = inserted.rows[0].id;
      created += 1;
    }

    // Which main/sub events this exhibitor takes part in, given as a
    // comma-separated list of event CODES (e.g. "MIFB27, MYFT26") — matched
    // by name the same way Agent/Salesperson/Billing Company are above.
    // Additive: an unlisted event is NOT removed, so a partial import can't
    // silently wipe participation the sheet simply didn't mention. Blank
    // leaves everything as-is.
    const eventCodes = cleanText(row.event_codes).split(',').map((c) => c.trim()).filter(Boolean);
    for (const code of eventCodes) {
      const ev = await pool.query(
        `SELECT id FROM events WHERE company_id = $1 AND UPPER(TRIM(code)) = $2`,
        [req.companyId, code]
      );
      if (!ev.rows[0]) {
        skipped.push(`${companyName}: event code "${code}" not found (exhibitor still saved, that event not linked)`);
        continue;
      }
      await pool.query(
        `INSERT INTO exhibitor_events (exhibitor_id, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [exhibitorId, ev.rows[0].id]
      );
    }
  }

  res.json({ success: true, created, updated, rowsProcessed: rows.length, skipped });
}

module.exports = {
  listExhibitors, getExhibitor, createExhibitor, updateExhibitor, importRepeatExhibitors, importExhibitors,
};
