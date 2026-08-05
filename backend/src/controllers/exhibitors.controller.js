const { pool } = require('../config/db');
const { getAccessibleEventIds } = require('../middleware/eventAccess');
const { visibilityClause, isElevated } = require('../utils/visibility');
const { cleanText, cleanLower, cleanKeepCase, cleanDigits } = require('../utils/importNormalize');
const { getGroupSharedCompanyIds } = require('../utils/groupSharing');

// Every query in here filters by req.companyId (set by middleware/tenant.js).
// This is the pattern every other Phase 1 module (opportunities, sales
// orders, invoices...) should follow.
async function listExhibitors(req, res) {
  const search = req.query.search || '';
  const eventId = req.query.event_id || null;

  // Ownership is per-event now (exhibitor_events.salesperson_id, migration
  // 078) — an exhibitor can be one rep's under MIFB and another's under
  // AgriFood. `effective_salesperson_id` is that event's owner where set,
  // falling back to the account-level owner so nothing regresses for
  // exhibitors that predate the per-event rows.
  //
  // Browsing with no search term still respects the normal own+unclaimed
  // visibility (keeps each rep's list focused/private day to day) — but the
  // moment there's a search term, every matching exhibitor company-wide is
  // returned (with its owner's name) so Sales can catch a duplicate before
  // creating one, instead of a same-name account under another rep being
  // invisible and silently re-created. The record itself still can't be
  // OPENED unless it's genuinely theirs — see getExhibitor.
  const effectiveOwner = eventId ? 'COALESCE(ee.salesperson_id, e.salesperson_id)' : 'e.salesperson_id';
  const vis = search ? { sql: 'TRUE', param: undefined } : visibilityClause(req, effectiveOwner, eventId ? 4 : 3);

  const params = [req.companyId, `%${search}%`];
  if (eventId) params.push(eventId);
  if (vis.param !== undefined) params.push(vis.param);

  const result = await pool.query(
    `SELECT e.id, e.company_name, e.country_code, cy.name AS country_name, e.contact1_name, e.contact1_email, e.is_active,
            ${effectiveOwner} AS salesperson_id,
            COALESCE(ue.full_name, u.full_name) AS salesperson_name,
            ${eventId ? '(ee.exhibitor_id IS NOT NULL)' : 'FALSE'} AS in_selected_event,
            -- Every event this exhibitor takes part in, so a rep searching
            -- for a possible duplicate can see where it already lives
            -- without being able to open it.
            (SELECT STRING_AGG(ev.code, ', ' ORDER BY ev.code)
               FROM exhibitor_events x JOIN events ev ON ev.id = x.event_id
              WHERE x.exhibitor_id = e.id) AS event_codes
     FROM exhibitors e
     LEFT JOIN users u ON u.id = e.salesperson_id
     LEFT JOIN countries cy ON cy.code = e.country_code
     ${eventId ? 'LEFT JOIN exhibitor_events ee ON ee.exhibitor_id = e.id AND ee.event_id = $3' : ''}
     ${eventId ? 'LEFT JOIN users ue ON ue.id = ee.salesperson_id' : 'LEFT JOIN users ue ON FALSE'}
     WHERE e.company_id = $1
       AND e.is_active = TRUE
       AND e.company_name ILIKE $2
       AND ${vis.sql}
     ORDER BY e.company_name
     LIMIT 200`,
    params
  );

  // Group-wide search (Phase 1 of group resource sharing, migration 079).
  // Runs ONLY on an explicit search — never on plain browsing — and as a
  // completely SEPARATE query, so the tenant-scoped query above is left
  // byte-for-byte unchanged. Results are flagged other_company: true and
  // carry no contact details; they exist purely to answer "is this company
  // already being handled somewhere in the group, and by whom?".
  // Opening one is still hard-blocked by getExhibitor's company_id filter.
  let groupMatches = [];
  if (search.trim()) {
    const peerCompanyIds = await getGroupSharedCompanyIds(req.companyId, 'EXHIBITORS');
    if (peerCompanyIds.length > 0) {
      const groupResult = await pool.query(
        `SELECT e.id, e.company_name, e.country_code, cy.name AS country_name,
                c.name AS owning_company_name,
                u.full_name AS salesperson_name,
                (SELECT STRING_AGG(ev.code, ', ' ORDER BY ev.code)
                   FROM exhibitor_events x JOIN events ev ON ev.id = x.event_id
                  WHERE x.exhibitor_id = e.id) AS event_codes
         FROM exhibitors e
         JOIN companies c ON c.id = e.company_id
         LEFT JOIN users u ON u.id = e.salesperson_id
         LEFT JOIN countries cy ON cy.code = e.country_code
         WHERE e.company_id = ANY($1::uuid[])
           AND e.is_active = TRUE
           AND e.company_name ILIKE $2
         ORDER BY e.company_name
         LIMIT 50`,
        [peerCompanyIds, `%${search}%`]
      );
      groupMatches = groupResult.rows.map((r) => ({ ...r, other_company: true }));
    }
  }

  res.json({ exhibitors: result.rows, groupMatches });
}

// Claim an exhibitor into an event and assign it to yourself — the
// cross-event/cross-team handover the user asked for: a rep working
// AgriFood finds an exhibitor already active under MIFB, and takes it on
// for THEIR event without touching the MIFB assignment.
// Additive by design: this only ever inserts/updates this one event's row.
async function claimExhibitorForEvent(req, res) {
  const { event_id } = req.body;
  if (!event_id) return res.status(400).json({ error: 'event_id is required.' });

  const exists = await pool.query(
    `SELECT company_name FROM exhibitors WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
    [req.params.id, req.companyId]
  );
  if (!exists.rows[0]) return res.status(404).json({ error: 'Exhibitor not found.' });

  const accessible = await getAccessibleEventIds(req.userId, req.companyId);
  if (!accessible.includes(event_id)) {
    return res.status(403).json({ error: 'You do not have access to that event.' });
  }

  await pool.query(
    `INSERT INTO exhibitor_events (exhibitor_id, event_id, salesperson_id, assigned_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (exhibitor_id, event_id)
       DO UPDATE SET salesperson_id = EXCLUDED.salesperson_id, assigned_at = now()`,
    [req.params.id, event_id, req.userId]
  );

  res.json({ success: true, exhibitor: { id: req.params.id, company_name: exists.rows[0].company_name } });
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
  // Visible if this user owns the exhibitor at account level OR owns it in
  // ANY event (per-event ownership, migration 078) — otherwise a rep who
  // claimed an exhibitor for their own event would be locked out of the
  // record they just claimed.
  const ownsAnywhere = `(ex.salesperson_id = $3 OR ex.salesperson_id IS NULL
     OR EXISTS (SELECT 1 FROM exhibitor_events ee WHERE ee.exhibitor_id = ex.id AND ee.salesperson_id = $3))`;
  const elevated = isElevated(req);
  const exhibitorResult = await pool.query(
    `SELECT ex.*, ag.name AS agent_name, be.company_name AS billing_exhibitor_name
     FROM exhibitors ex
     LEFT JOIN agents ag ON ag.id = ex.agent_id
     LEFT JOIN exhibitors be ON be.id = ex.billing_exhibitor_id
     WHERE ex.id = $1 AND ex.company_id = $2 ${elevated ? '' : `AND ${ownsAnywhere}`}`,
    elevated ? [req.params.id, req.companyId] : [req.params.id, req.companyId, req.userId]
  );
  const exhibitor = exhibitorResult.rows[0];
  if (!exhibitor) {
    // Distinguish "doesn't exist" from "exists but isn't yours" — a bare
    // 404 for the latter is what makes reps re-create a duplicate they were
    // never allowed to see. Name the current owner and events so they can
    // go ask, or claim it for their own event, instead (search already
    // surfaces it; this is the same information on direct navigation).
    const blocked = await pool.query(
      `SELECT ex.company_name, u.full_name AS owner_name,
              (SELECT STRING_AGG(ev.code, ', ' ORDER BY ev.code)
                 FROM exhibitor_events x JOIN events ev ON ev.id = x.event_id
                WHERE x.exhibitor_id = ex.id) AS event_codes
       FROM exhibitors ex
       LEFT JOIN users u ON u.id = ex.salesperson_id
       WHERE ex.id = $1 AND ex.company_id = $2`,
      [req.params.id, req.companyId]
    );
    if (blocked.rows[0]) {
      const b = blocked.rows[0];
      return res.status(403).json({
        error: `"${b.company_name}" is assigned to ${b.owner_name || 'another salesperson'}`
          + `${b.event_codes ? ` (events: ${b.event_codes})` : ''}.`
          + ' Ask them to hand it over, or claim it for your own event from the Exhibitors search.',
        blocked: { company_name: b.company_name, owner_name: b.owner_name, event_codes: b.event_codes },
      });
    }
    return res.status(404).json({ error: 'Exhibitor not found.' });
  }

  const segmentsResult = await pool.query(
    `SELECT segment_main_id, segment_sub_id, remarks
     FROM exhibitor_segments WHERE exhibitor_id = $1`,
    [exhibitor.id]
  );
  const eventsResult = await pool.query(
    `SELECT ee.event_id, ee.salesperson_id, u.full_name AS salesperson_name
     FROM exhibitor_events ee
     LEFT JOIN users u ON u.id = ee.salesperson_id
     WHERE ee.exhibitor_id = $1`,
    [exhibitor.id]
  );

  res.json({
    exhibitor: {
      ...exhibitor,
      segments: segmentsResult.rows,
      event_ids: eventsResult.rows.map((r) => r.event_id),
      // Per-event ownership (migration 078) — who holds this exhibitor in
      // each event they take part in. Sent alongside the plain event_ids
      // list so the existing participation checkboxes keep working
      // unchanged while the detail screen can also show the assignments.
      event_assignments: eventsResult.rows,
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
    // This function replaces participation wholesale (delete-then-insert),
    // which would otherwise WIPE each row's per-event salesperson_id
    // (migration 078) every time someone saved the Exhibitor form — a
    // silent loss of assignment data. Snapshot the existing owners first
    // and restore them for any event that survives the replace.
    const priorRows = await client.query(
      `SELECT event_id, salesperson_id, assigned_at FROM exhibitor_events WHERE exhibitor_id = $1`,
      [exhibitorId]
    );
    const priorByEvent = Object.fromEntries(priorRows.rows.map((r) => [r.event_id, r]));

    await client.query(
      `DELETE FROM exhibitor_events WHERE exhibitor_id = $1 AND event_id = ANY($2)`,
      [exhibitorId, accessible]
    );
    for (const eventId of allowed) {
      const prior = priorByEvent[eventId];
      await client.query(
        `INSERT INTO exhibitor_events (exhibitor_id, event_id, salesperson_id, assigned_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [exhibitorId, eventId, prior?.salesperson_id || null, prior?.assigned_at || null]
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
  claimExhibitorForEvent,
};
