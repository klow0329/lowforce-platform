const { pool } = require('../config/db');
const { visibilityClause } = require('../utils/visibility');
const { syncFloorPlanBooth, releaseFloorPlanBooth } = require('../utils/floorPlanSync');
const { getRequiredApprover, canActOnTier, hasStep2, canActOnStep2 } = require('../utils/approverMatrix');

// Mirrors approvals.controller.js's own copy — kept local since this is a
// read-only display helper, not the enforcement path.
async function getPendingSince(salesOrderId) {
  const result = await pool.query(
    `SELECT MAX(created_at) AS since FROM approval_log WHERE sales_order_id = $1 AND action IN ('SUBMITTED', 'FLAGGED')`,
    [salesOrderId]
  );
  return result.rows[0]?.since || null;
}

async function listSalesOrders(req, res) {
  const { event_id, search } = req.query;
  if (!event_id) {
    return res.status(400).json({ error: 'event_id is required.' });
  }

  const vis = visibilityClause(req, 'so.salesperson_id', 4);

  const result = await pool.query(
    `SELECT so.id, so.contract_type, so.contract_date, so.total_myr, so.status,
            so.hall, COALESCE(fp.booth_nos, so.booth_no) AS booth_no,
            so.total_sqm,
            ex.company_name AS exhibitor_name, ex.country_code AS exhibitor_country, u.full_name AS salesperson_name,
            ag.name AS agent_name,
            -- A pending Value Change (contract_reductions) doesn't touch
            -- so.status itself — the contract stays exactly as-approved
            -- until the request resolves — but the list should still say so
            -- is under review rather than just "Approved" (2026-08-01 user
            -- request). Reverts to plain Approved automatically once the
            -- request is approved/rejected/withdrawn, since this is a live
            -- EXISTS check, not a stored flag.
            EXISTS (
              SELECT 1 FROM contract_reductions cr WHERE cr.sales_order_id = so.id AND cr.status = 'PENDING_APPROVAL'
            ) AS has_pending_value_change,
            -- Same derivation as the Opportunity list — see that query's
            -- comment.
            COALESCE(
              (SELECT soi.description FROM sales_order_items soi
               WHERE soi.sales_order_id = so.id AND soi.category = 'BOOTH'
                 AND soi.sales_item_code != COALESCE((SELECT pl.sales_item_code FROM price_list pl WHERE pl.company_id = so.company_id AND pl.event_id = so.event_id AND pl.is_primary_base = true LIMIT 1), 'BAS')
               ORDER BY soi.sort_order, soi.id LIMIT 1),
              (SELECT soi2.description FROM sales_order_items soi2
               WHERE soi2.sales_order_id = so.id
                 AND soi2.sales_item_code = COALESCE((SELECT pl.sales_item_code FROM price_list pl WHERE pl.company_id = so.company_id AND pl.event_id = so.event_id AND pl.is_primary_base = true LIMIT 1), 'BAS')
               LIMIT 1)
            ) AS booth_type_display
     FROM sales_orders so
     JOIN exhibitors ex ON ex.id = so.exhibitor_id
     LEFT JOIN users u ON u.id = so.salesperson_id
     LEFT JOIN agents ag ON ag.id = ex.agent_id
     LEFT JOIN LATERAL (
       SELECT STRING_AGG(b.booth_no, ', ' ORDER BY b.booth_no) AS booth_nos
       FROM floor_plan_booths b WHERE b.sales_order_id = so.id
     ) fp ON true
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
            ex.company_name, ex.company_name_alt, ex.country_code, cy.name AS country_name,
            ex.contact1_name, ex.contact1_email, ex.contact1_phone, ex.contact1_job_title,
            ex.contact2_name, ex.contact2_email, ex.contact2_phone, ex.contact2_job_title,
            ex.address, ex.postcode, ex.city, ex.state, ex.website, ex.fax,
            ex.reg_no, ex.tin_no, ex.sst_no,
            ex.billing_name, ex.billing_address, ex.billing_postcode, ex.billing_city,
            ex.billing_country_code, bcy.name AS billing_country_name, ex.billing_reg_no, ex.billing_tin_no, ex.billing_sst_no,
            ex.billing_contact_no, ex.billing_email, ex.billing_same_as_company,
            ag.name AS agent_name,
            ev.name AS event_name, ev.venue AS event_venue, ev.start_date AS event_start_date, ev.end_date AS event_end_date,
            u.full_name AS salesperson_name,
            o.booth_sqm, o.booth_type,
            -- Same persistent-alert signal as getOpportunity — see that
            -- query's comment.
            EXISTS (
              SELECT 1 FROM floor_plan_booth_claims c
              WHERE c.record_type = 'sales_order' AND c.record_id = so.id
                AND c.release_reason = 'LOST_TO_APPROVAL' AND c.reallocated_at IS NULL
            ) AS needs_booth_reallocation,
            EXISTS (
              SELECT 1 FROM contract_reductions cr WHERE cr.sales_order_id = so.id AND cr.status = 'PENDING_APPROVAL'
            ) AS has_pending_value_change
     FROM sales_orders so
     JOIN exhibitors ex ON ex.id = so.exhibitor_id
     JOIN events ev ON ev.id = so.event_id
     LEFT JOIN users u ON u.id = so.salesperson_id
     LEFT JOIN opportunities o ON o.id = so.opportunity_id
     LEFT JOIN agents ag ON ag.id = ex.agent_id
     LEFT JOIN countries cy ON cy.code = ex.country_code
     LEFT JOIN countries bcy ON bcy.code = ex.billing_country_code
     WHERE so.id = $1 AND so.company_id = $2 AND ${vis.sql}`,
    [req.params.id, req.companyId, ...(vis.param !== undefined ? [vis.param] : [])]
  );

  const salesOrder = result.rows[0];
  if (!salesOrder) {
    return res.status(404).json({ error: 'Sales order not found.' });
  }

  // Tells the frontend exactly who's allowed to Approve/Reject this specific
  // contract (a tiered-matrix approver may not be Admin/Management at all),
  // and whether the CURRENT user is one of them — so the buttons show for
  // the right person instead of only ever showing for isElevated.
  let requiredApprover = null;
  let canApprove = false;
  let approvalStep = null; // 1 (awaiting 1st sign-off) or 2 (1st given, awaiting 2nd) — only set when the tier has a step-2 approver
  if (salesOrder.status === 'PENDING_APPROVAL' || salesOrder.status === 'PENDING_APPROVAL_STEP2') {
    const tier = await getRequiredApprover(req.companyId, Number(salesOrder.total_myr) || 0, 'REVENUE_ABOVE_THRESHOLD', salesOrder.event_id);
    if (salesOrder.status === 'PENDING_APPROVAL_STEP2') {
      approvalStep = 2;
      requiredApprover = { role_code: tier?.step2_approver_role_code || null, user_name: tier?.step2_approver_user_name || null };
      canApprove = canActOnStep2(req, tier);
    } else {
      approvalStep = hasStep2(tier) ? 1 : null;
      requiredApprover = tier
        ? { role_code: tier.approver_role_code, user_name: tier.approver_user_name }
        : { role_code: null, user_name: null }; // null/null = default Admin/Management gate
      canApprove = canActOnTier(req, tier, await getPendingSince(req.params.id));
    }
  }

  res.json({ salesOrder, requiredApprover, canApprove, approvalStep });
}

async function createSalesOrder(req, res) {
  const { exhibitor_id, event_id, opportunity_id, salesperson_id, contract_type, contract_date, currency,
          hall, booth_no, dimension, total_sqm, booking_type, remarks, bill_to_type } = req.body;

  if (!exhibitor_id || !event_id) {
    return res.status(400).json({ error: 'exhibitor_id and event_id are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Carries the Proposal's chosen recipient name (Exhibitor/Billing/Agent)
    // and Remarks over to the new Contract by default, same as Hall/Booth
    // No — the caller can still override bill_to_type explicitly. Remarks
    // becomes the same SHARED value going forward (see updateOpportunity/
    // updateSalesOrder/updateInvoice's cascades) — this is just its initial
    // copy at the moment the Contract is generated.
    let billToType = bill_to_type || 'BILLING';
    let contractRemarks = remarks || null;
    if (opportunity_id) {
      const opp = await client.query(`SELECT bill_to_type, remarks FROM opportunities WHERE id = $1`, [opportunity_id]);
      if (!bill_to_type && opp.rows[0]?.bill_to_type) billToType = opp.rows[0].bill_to_type;
      if (!remarks && opp.rows[0]?.remarks) contractRemarks = opp.rows[0].remarks;
    }

    // One opportunity should only ever have one live (non-Void) contract —
    // without this, a double "Generate Contract" click (e.g. via the
    // browser back button re-showing an already-submitted form) silently
    // created a genuine duplicate.
    if (opportunity_id) {
      const existing = await client.query(
        `SELECT id FROM sales_orders WHERE opportunity_id = $1 AND company_id = $2 AND status != 'VOID'`,
        [opportunity_id, req.companyId]
      );
      if (existing.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'A contract already exists for this opportunity.', existingSalesOrderId: existing.rows[0].id });
      }
    }

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

    // Every new contract starts as a Draft — it only becomes APPROVED after
    // an explicit "Send for Approval" step and an Admin/Management approval
    // (see approvals.controller.js). Nothing auto-approves anymore. Creating
    // a contract also does NOT move the linked opportunity to Won by itself
    // — that's still just a draft at this point, not a closed deal; the
    // opportunity only advances via the explicit prompts tied to actually
    // sending the (approved) contract and issuing the invoice.
    const result = await client.query(
      `INSERT INTO sales_orders (company_id, exhibitor_id, event_id, opportunity_id, salesperson_id,
                                 contract_type, contract_date, currency, exchange_rate, total_myr, total_foreign,
                                 hall, booth_no, dimension, total_sqm, booking_type, remarks, bill_to_type, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, 0, $10, $11, $12, $13, $14, $15, $16, 'DRAFT')
       RETURNING id`,
      [
        req.companyId, exhibitor_id, event_id, opportunity_id || null, salesperson_id || null,
        contract_type || 'STANDARD', contract_date || new Date().toISOString().slice(0, 10), contractCurrency, exchangeRate,
        hall || null, booth_no || null, dimension || null, total_sqm || null, booking_type || null, contractRemarks, billToType,
      ]
    );

    // Transfer booth ownership from the opportunity to this new contract —
    // without this, a booth picked while this was still an Opportunity
    // stayed linked ONLY to opportunity_id forever, so it could never
    // compute as SOLD (that requires sales_order_id + an APPROVED status)
    // even once the contract itself was fully approved, and the Contracts
    // list's booth-allocation column would always read as unallocated for
    // it. The Hall/Booth No text snapshot was already being carried over by
    // the caller (OpportunityDetail.jsx's handleGenerateContract) — this is
    // the piece that was missing: the real floor_plan_booths link itself.
    if (opportunity_id) {
      await client.query(
        `UPDATE floor_plan_booths SET sales_order_id = $1, opportunity_id = NULL
         WHERE opportunity_id = $2`,
        [result.rows[0].id, opportunity_id]
      );
      // Carry the opportunity's own booth claims (including any secondary,
      // non-primary ones — competing-claims rule, Round 6 item 4) over to
      // this new contract, so it keeps competing for the same booths rather
      // than silently dropping them.
      await client.query(
        `UPDATE floor_plan_booth_claims SET record_type = 'sales_order', record_id = $1
         WHERE record_type = 'opportunity' AND record_id = $2 AND released_at IS NULL`,
        [result.rows[0].id, opportunity_id]
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
// corrected before it's invoiced. hall/booth_no/total_sqm are likewise NOT
// editable here — they're derived from the record's actual Floor Plan booth
// claims (see floorPlan.controller.js's bulkSetRecordBooths ->
// recomputeCachedBoothFields, the only legitimate writer). They used to be
// in this whitelist, which meant a stale browser tab — one that loaded
// before a booth claim was won/lost/deselected out from under it — could
// silently overwrite the server's already-correct value back to the old one
// on the next unrelated Save (e.g. editing a remark), re-diverging Total Sqm
// from what the exhibitor's billing and other reports actually reconciled
// to. Found live: this is what happened to two MIFB27 contracts after a
// booth was lost/removed post-approval.
const SALES_ORDER_FIELDS = ['contract_type', 'contract_date', 'currency', 'exchange_rate', 'dimension', 'booking_type', 'remarks', 'credit_terms_id', 'bill_to_type'];

async function updateSalesOrder(req, res) {
  const fields = {};
  for (const field of SALES_ORDER_FIELDS) {
    if (field in req.body) fields[field] = req.body[field] === '' ? null : req.body[field];
  }
  const columns = Object.keys(fields);

  if (columns.length === 0 && !('floor_plan_booth_id' in req.body)) {
    return res.json({ salesOrder: { id: req.params.id } });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (columns.length > 0) {
      const setClause = columns.map((c, i) => `${c} = $${i + 3}`).join(', ');
      const result = await client.query(
        `UPDATE sales_orders SET ${setClause}
         WHERE id = $1 AND company_id = $2
         RETURNING id, opportunity_id`,
        [req.params.id, req.companyId, ...columns.map((c) => fields[c])]
      );
      if (!result.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Sales order not found.' });
      }

      // Same reasoning as the Opportunity side: Booth No is a plain editable
      // text field too, not just set via the picker — clearing it by hand
      // without picking a replacement should release the linked booth.
      if ('booth_no' in fields && fields.booth_no === null && !('floor_plan_booth_id' in req.body)) {
        await releaseFloorPlanBooth(client, req.companyId, 'sales_order_id', req.params.id);
      }

      // Remarks is one shared value per deal — push it up to the linked
      // Opportunity (if any) and out to every one of this Contract's own
      // Invoices, same as the Opportunity/Invoice sides push into here.
      if ('remarks' in fields) {
        if (result.rows[0].opportunity_id) {
          await client.query(
            `UPDATE opportunities SET remarks = $1 WHERE id = $2 AND company_id = $3`,
            [fields.remarks, result.rows[0].opportunity_id, req.companyId]
          );
        }
        await client.query(
          `UPDATE invoices SET remarks = $1 WHERE sales_order_id = $2 AND company_id = $3`,
          [fields.remarks, req.params.id, req.companyId]
        );
      }
    }

    // Same "only lock once the save genuinely succeeds" rule as the
    // Opportunity picker — picking a booth on the Floor Plan screen itself
    // doesn't touch it; it only commits here, as SOLD (a contract is a
    // signed deal, not just a quote).
    if ('floor_plan_booth_id' in req.body) {
      const sync = await syncFloorPlanBooth(client, req.companyId, {
        linkColumn: 'sales_order_id', linkId: req.params.id,
        floorPlanBoothId: req.body.floor_plan_booth_id, exhibitorName: req.body.exhibitor_name,
      });
      if (!sync.ok) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: sync.error });
      }
    }

    await client.query('COMMIT');
    res.json({ salesOrder: { id: req.params.id } });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { listSalesOrders, getSalesOrder, createSalesOrder, updateSalesOrder };
