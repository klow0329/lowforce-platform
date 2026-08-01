const { pool } = require('../config/db');
const { visibilityClause } = require('../utils/visibility');
const { syncFloorPlanBooth, releaseFloorPlanBooth } = require('../utils/floorPlanSync');

// Pipeline list — filterable by event, stage, salesperson ("My
// Opportunities"), exhibitor (for the "linked opportunities" list on the
// Exhibitor detail screen, which spans all events), and a free-text search
// on the exhibitor's company name. At least one of event_id/exhibitor_id
// is required so this can't accidentally return the whole company's pipeline.
async function listOpportunities(req, res) {
  const { event_id, stage_id, salesperson_id, exhibitor_id, search } = req.query;

  if (!event_id && !exhibitor_id) {
    return res.status(400).json({ error: 'event_id or exhibitor_id is required.' });
  }

  const vis = visibilityClause(req, 'o.salesperson_id', 7);

  const result = await pool.query(
    `SELECT o.id, o.exhibitor_id, ex.company_name AS exhibitor_name, ex.country_code AS exhibitor_country,
            ag.name AS agent_name,
            o.event_id, ev.name AS event_name,
            o.salesperson_id, u.full_name AS salesperson_name,
            o.stage_id, st.code AS stage_code, st.name AS stage_name,
            st.probability_pct, st.is_won, st.is_lost,
            o.total_sqm, o.booth_type, o.booking_type, o.currency, o.estimated_value_myr, o.next_follow_up_date, o.remarks,
            o.created_at,
            -- The primary base item (e.g. Bare Space — see price_list's
            -- is_primary_base flag) if that's the only booth item; otherwise
            -- the first upgraded booth item's own description (e.g. "Shell
            -- Scheme") — always derived live from the actual billing lines,
            -- never a separately-stored value, so it can never drift out of
            -- sync. Falls back to the literal 'BAS' for any event that
            -- hasn't flagged a primary base item.
            COALESCE(
              (SELECT oi.description FROM opportunity_items oi
               WHERE oi.opportunity_id = o.id AND oi.category = 'BOOTH'
                 AND oi.sales_item_code != COALESCE((SELECT pl.sales_item_code FROM price_list pl WHERE pl.company_id = o.company_id AND pl.event_id = o.event_id AND pl.is_primary_base = true LIMIT 1), 'BAS')
               ORDER BY oi.sort_order, oi.id LIMIT 1),
              (SELECT oi2.description FROM opportunity_items oi2
               WHERE oi2.opportunity_id = o.id
                 AND oi2.sales_item_code = COALESCE((SELECT pl.sales_item_code FROM price_list pl WHERE pl.company_id = o.company_id AND pl.event_id = o.event_id AND pl.is_primary_base = true LIMIT 1), 'BAS')
               LIMIT 1)
            ) AS booth_type_display,
            (SELECT so.id FROM sales_orders so WHERE so.opportunity_id = o.id AND so.status != 'VOID' ORDER BY so.contract_date DESC NULLS LAST LIMIT 1) AS existing_sales_order_id,
            -- A pending Value Change on the linked Contract (2026-08-01) —
            -- same live EXISTS signal as the Contract list's own column.
            EXISTS (
              SELECT 1 FROM contract_reductions cr
              JOIN sales_orders so2 ON so2.id = cr.sales_order_id
              WHERE so2.opportunity_id = o.id AND cr.status = 'PENDING_APPROVAL'
            ) AS has_pending_value_change,
            -- Latest correspondence log entry — see correspondence.controller.js.
            (SELECT c.note FROM correspondence_entries c
             WHERE c.entity_type = 'opportunity' AND c.entity_id = o.id
             ORDER BY c.created_at DESC LIMIT 1) AS latest_correspondence,
            (SELECT c.created_at FROM correspondence_entries c
             WHERE c.entity_type = 'opportunity' AND c.entity_id = o.id
             ORDER BY c.created_at DESC LIMIT 1) AS latest_correspondence_at
     FROM opportunities o
     JOIN exhibitors ex ON ex.id = o.exhibitor_id
     JOIN events ev ON ev.id = o.event_id
     JOIN sales_stages st ON st.id = o.stage_id
     LEFT JOIN users u ON u.id = o.salesperson_id
     LEFT JOIN agents ag ON ag.id = ex.agent_id
     WHERE o.company_id = $1
       AND ($2::uuid IS NULL OR o.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2))
       AND o.is_active = TRUE
       AND ($3::uuid IS NULL OR o.stage_id = $3)
       AND ($4::uuid IS NULL OR o.salesperson_id = $4)
       AND ($5 = '' OR ex.company_name ILIKE '%' || $5 || '%')
       AND ($6::uuid IS NULL OR o.exhibitor_id = $6)
       AND ${vis.sql}
     ORDER BY o.next_follow_up_date NULLS LAST, ex.company_name`,
    [req.companyId, event_id || null, stage_id || null, salesperson_id || null, search || '', exhibitor_id || null,
     ...(vis.param !== undefined ? [vis.param] : [])]
  );

  res.json({ opportunities: result.rows });
}

// Rollup by stage — value / sqm / company count / conversion rate, matching
// the current Excel OPPORTUNITY tab. Conversion rate = won / (won + lost),
// mirroring how the Excel workbook defines it (open opportunities aren't
// counted as "not converted" since they haven't resolved either way yet).
async function getOpportunitySummary(req, res) {
  const { event_id } = req.query;
  if (!event_id) {
    return res.status(400).json({ error: 'event_id is required.' });
  }

  const vis = visibilityClause(req, 'o.salesperson_id', 3);

  const result = await pool.query(
    `SELECT st.id AS stage_id, st.code, st.name, st.sort_order, st.is_won, st.is_lost,
            COUNT(o.id) AS opp_count,
            COALESCE(SUM(o.estimated_value_myr), 0) AS total_value_myr,
            COALESCE(SUM(o.total_sqm), 0) AS total_sqm,
            COUNT(DISTINCT o.exhibitor_id) AS company_count
     FROM sales_stages st
     LEFT JOIN opportunities o
       ON o.stage_id = st.id AND o.company_id = st.company_id
      AND o.event_id IN (SELECT id FROM events WHERE id = $2 OR parent_event_id = $2)
      AND o.is_active = TRUE
      AND ${vis.sql}
     WHERE st.company_id = $1
     GROUP BY st.id, st.code, st.name, st.sort_order, st.is_won, st.is_lost
     ORDER BY st.sort_order`,
    [req.companyId, event_id, ...(vis.param !== undefined ? [vis.param] : [])]
  );

  const wonCount = result.rows.filter((r) => r.is_won).reduce((sum, r) => sum + Number(r.opp_count), 0);
  const lostCount = result.rows.filter((r) => r.is_lost).reduce((sum, r) => sum + Number(r.opp_count), 0);
  const resolvedCount = wonCount + lostCount;
  const conversionRatePct = resolvedCount > 0 ? (wonCount / resolvedCount) * 100 : 0;

  const totals = result.rows.reduce(
    (acc, r) => ({
      opp_count: acc.opp_count + Number(r.opp_count),
      total_value_myr: acc.total_value_myr + Number(r.total_value_myr),
      total_sqm: acc.total_sqm + Number(r.total_sqm),
    }),
    { opp_count: 0, total_value_myr: 0, total_sqm: 0 }
  );

  res.json({ byStage: result.rows, totals: { ...totals, conversionRatePct } });
}

async function getOpportunity(req, res) {
  const vis = visibilityClause(req, 'o.salesperson_id', 3);
  const result = await pool.query(
    `SELECT o.*, ex.company_name AS exhibitor_name,
            ex.country_code, ex.contact1_name, ex.contact1_email, ex.contact1_phone,
            ex.postcode, ex.city, ex.reg_no, ex.tin_no, ex.sst_no,
            ex.billing_name, ex.billing_address, ex.billing_postcode, ex.billing_city,
            ex.billing_country_code, ex.billing_reg_no, ex.billing_tin_no, ex.billing_sst_no,
            ex.billing_contact_no, ex.billing_email, ex.billing_same_as_company,
            ag.name AS agent_name,
            ev.name AS event_name,
            (SELECT so.id FROM sales_orders so WHERE so.opportunity_id = o.id AND so.status != 'VOID' ORDER BY so.contract_date DESC NULLS LAST LIMIT 1) AS existing_sales_order_id,
            -- A booth was lost to a competing contract's approval and the
            -- user hasn't picked a replacement yet (see FloorPlan.jsx's
            -- bulkSetRecordBooths, which clears this the moment they commit
            -- a new pick) — drives a persistent banner, separate from the
            -- dismissible Task To-Do notification.
            EXISTS (
              SELECT 1 FROM floor_plan_booth_claims c
              WHERE c.record_type = 'opportunity' AND c.record_id = o.id
                AND c.release_reason = 'LOST_TO_APPROVAL' AND c.reallocated_at IS NULL
            ) AS needs_booth_reallocation
     FROM opportunities o
     JOIN exhibitors ex ON ex.id = o.exhibitor_id
     JOIN events ev ON ev.id = o.event_id
     LEFT JOIN agents ag ON ag.id = ex.agent_id
     WHERE o.id = $1 AND o.company_id = $2 AND ${vis.sql}`,
    [req.params.id, req.companyId, ...(vis.param !== undefined ? [vis.param] : [])]
  );
  const opportunity = result.rows[0];
  if (!opportunity) {
    return res.status(404).json({ error: 'Opportunity not found.' });
  }
  res.json({ opportunity });
}

// hall/booth_no/total_sqm are NOT editable here — they're derived from the
// record's actual Floor Plan booth claims (see floorPlan.controller.js's
// bulkSetRecordBooths -> recomputeCachedBoothFields, the only legitimate
// writer). Leaving them client-writable meant a stale browser tab could
// silently overwrite the server's already-correct value on the next
// unrelated Save — see the matching comment on salesOrders.controller.js's
// SALES_ORDER_FIELDS for the live case this caused.
const OPPORTUNITY_FIELDS = [
  'exhibitor_id', 'event_id', 'salesperson_id', 'stage_id', 'booking_type', 'currency',
  'booth_sqm', 'booth_type', 'dimension', 'credit_terms_id',
  'estimated_value_myr', 'next_follow_up_date', 'remarks', 'bill_to_type',
];

function pickOpportunityFields(body) {
  const out = {};
  for (const field of OPPORTUNITY_FIELDS) {
    if (field in body) out[field] = body[field] === '' ? null : body[field];
  }
  return out;
}

async function createOpportunity(req, res) {
  const fields = pickOpportunityFields(req.body);

  if (!fields.exhibitor_id || !fields.event_id || !fields.stage_id) {
    return res.status(400).json({ error: 'exhibitor_id, event_id and stage_id are required.' });
  }
  if (!fields.booking_type || !fields.currency) {
    return res.status(400).json({ error: 'Tier and Currency are required.' });
  }

  const columns = Object.keys(fields);
  const placeholders = columns.map((_, i) => `$${i + 2}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO opportunities (company_id, ${columns.join(', ')})
       VALUES ($1, ${placeholders.join(', ')})
       RETURNING id`,
      [req.companyId, ...columns.map((c) => fields[c])]
    );
    const opportunityId = result.rows[0].id;

    // A booth picked from the Floor Plan only actually locks once the
    // opportunity it's for has genuinely been saved — picking it on the
    // Floor Plan screen itself doesn't touch the booth at all (see
    // FloorPlan.jsx). Real-world testing found the opposite (lock on pick)
    // orphans the booth if the user picks one and then abandons the form.
    if (req.body.floor_plan_booth_id) {
      const sync = await syncFloorPlanBooth(client, req.companyId, {
        linkColumn: 'opportunity_id', linkId: opportunityId,
        floorPlanBoothId: req.body.floor_plan_booth_id, exhibitorName: req.body.exhibitor_name,
      });
      if (!sync.ok) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: sync.error });
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ opportunity: { id: opportunityId } });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateOpportunity(req, res) {
  const fields = pickOpportunityFields(req.body);
  // Shown next to Stage on the detail page — stamped automatically, not
  // sent by the client, same "last touched" convention as invoices'
  // aging_updated_at.
  if ('stage_id' in fields) fields.stage_changed_at = new Date();
  const columns = Object.keys(fields);

  if (columns.length === 0 && !('floor_plan_booth_id' in req.body)) {
    return res.json({ opportunity: { id: req.params.id } });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (columns.length > 0) {
      const setClause = columns.map((c, i) => `${c} = $${i + 3}`).join(', ');
      const result = await client.query(
        `UPDATE opportunities SET ${setClause}
         WHERE id = $1 AND company_id = $2
         RETURNING id, exhibitor_id`,
        [req.params.id, req.companyId, ...columns.map((c) => fields[c])]
      );
      if (!result.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Opportunity not found.' });
      }

      // A deal marked Lost releases whatever booth it was holding — it
      // shouldn't keep a real booth off the market for a deal that fell
      // through. The exhibitor ACCOUNT is only released back to the pool
      // for another rep once EVERY one of its opportunities is Lost — if
      // another one is still open (or Won), this rep keeps the account,
      // even though this particular deal fell through.
      if (fields.stage_id) {
        const stage = await client.query(`SELECT is_lost FROM sales_stages WHERE id = $1`, [fields.stage_id]);
        if (stage.rows[0]?.is_lost) {
          await releaseFloorPlanBooth(client, req.companyId, 'opportunity_id', req.params.id);

          const stillOpen = await client.query(
            `SELECT 1 FROM opportunities o
             JOIN sales_stages st ON st.id = o.stage_id
             WHERE o.exhibitor_id = $1 AND o.company_id = $2 AND o.is_active = TRUE
               AND o.id != $3 AND st.is_lost = FALSE
             LIMIT 1`,
            [result.rows[0].exhibitor_id, req.companyId, req.params.id]
          );
          if (!stillOpen.rows[0]) {
            await client.query(
              `UPDATE exhibitors SET salesperson_id = NULL WHERE id = $1 AND company_id = $2`,
              [result.rows[0].exhibitor_id, req.companyId]
            );
          }
        }
      }

      // Booth No is also a plain editable text field (not just set via the
      // Floor Plan picker) — if the user clears it by hand and isn't
      // simultaneously picking a replacement booth, treat that the same as
      // an explicit release so the Floor Plan side doesn't keep showing a
      // booth this record no longer claims.
      if ('booth_no' in fields && fields.booth_no === null && !('floor_plan_booth_id' in req.body)) {
        await releaseFloorPlanBooth(client, req.companyId, 'opportunity_id', req.params.id);
      }

      // Remarks is one shared value per deal — push it down to the live
      // Contract (if one exists yet) and every one of that Contract's
      // Invoices, same as editing it on either of those screens pushes back
      // up here (see updateSalesOrder/updateInvoice).
      if ('remarks' in fields) {
        await client.query(
          `UPDATE sales_orders so SET remarks = $1
           WHERE so.opportunity_id = $2 AND so.company_id = $3 AND so.status != 'VOID'`,
          [fields.remarks, req.params.id, req.companyId]
        );
        await client.query(
          `UPDATE invoices inv SET remarks = $1
           FROM sales_orders so
           WHERE inv.sales_order_id = so.id AND so.opportunity_id = $2 AND inv.company_id = $3 AND so.status != 'VOID'`,
          [fields.remarks, req.params.id, req.companyId]
        );
      }
    }

    if ('floor_plan_booth_id' in req.body) {
      const sync = await syncFloorPlanBooth(client, req.companyId, {
        linkColumn: 'opportunity_id', linkId: req.params.id,
        floorPlanBoothId: req.body.floor_plan_booth_id, exhibitorName: req.body.exhibitor_name,
      });
      if (!sync.ok) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: sync.error });
      }
    }

    await client.query('COMMIT');
    res.json({ opportunity: { id: req.params.id } });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  listOpportunities,
  getOpportunitySummary,
  getOpportunity,
  createOpportunity,
  updateOpportunity,
};
