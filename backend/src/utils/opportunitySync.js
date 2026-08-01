const { pool } = require('../config/db');
const { getBoothDrivenCodes } = require('./priceListHelpers');
const { recomputeTotals } = require('../controllers/opportunityItems.controller');
const { recomputeCachedBoothFields } = require('./floorPlanClaims');

// Once a Contract exists, its booths/billing live independently of the
// Opportunity that spawned it — the Opportunity's own hall/booth_no/
// total_sqm and opportunity_items were only ever set once, at conversion
// time, and nothing re-syncs them afterward. So a later booth change on the
// Contract (Change Booth, a Contract Reduction/CN approval) left the
// Opportunity showing stale pre-conversion data if anyone reopened it —
// confusing, and specifically flagged by the user (2026-07-31) after the
// same class of Floor-Plan/Billing desync bug this session already fixed
// elsewhere. Call this from inside the SAME transaction as whatever just
// changed the Contract's booths, right after that change is written.
//
// Only mirrors booth-driven rows (Bare Space/Upgrade/Corner/Loading/any
// is_booth_related addon) — MEP/Sponsorship/Other/Badge are independent
// per-record manual decisions and are left untouched on the Opportunity
// side, exactly as confirmed with the user.
async function mirrorContractToOpportunity(client, companyId, salesOrderId) {
  const so = await client.query(
    `SELECT opportunity_id, event_id, hall, booth_no, total_sqm FROM sales_orders WHERE id = $1 AND company_id = $2`,
    [salesOrderId, companyId]
  );
  const row = so.rows[0];
  if (!row || !row.opportunity_id) return;

  await client.query(
    `UPDATE opportunities SET hall = $1, booth_no = $2, total_sqm = $3 WHERE id = $4 AND company_id = $5`,
    [row.hall, row.booth_no, row.total_sqm, row.opportunity_id, companyId]
  );

  const boothDrivenCodes = await getBoothDrivenCodes(companyId, row.event_id, client);

  await client.query(
    `DELETE FROM opportunity_items WHERE opportunity_id = $1 AND sales_item_code = ANY($2::text[])`,
    [row.opportunity_id, boothDrivenCodes]
  );
  await client.query(
    `INSERT INTO opportunity_items
       (opportunity_id, price_list_id, sales_item_code, description, category, qty, unit_price,
        discount_type, discount_value, tax_code_id, tax_rate_pct, subtotal, discount_amount, tax_amount, line_total, sort_order)
     SELECT $1, price_list_id, sales_item_code, description, category, qty, unit_price,
            discount_type, discount_value, tax_code_id, tax_rate_pct, subtotal, discount_amount, tax_amount, line_total, sort_order
     FROM sales_order_items
     WHERE sales_order_id = $2 AND sales_item_code = ANY($3::text[])`,
    [row.opportunity_id, salesOrderId, boothDrivenCodes]
  );

  await recomputeTotals(client, row.opportunity_id, companyId);
}

// Recomputes a record's own Hall/Booth No/Total Sqm from its live claims,
// then — for a Contract — immediately mirrors that onto its linked
// Opportunity too. Every code path that adds or releases a claim (Change
// Booth, CN/Contract Reduction approval, a competing claim lost when another
// record's contract gets approved) must go through this, not
// recomputeCachedBoothFields alone — otherwise the Contract's own cached
// total_sqm gets refreshed but the Opportunity is left showing whatever it
// last mirrored, silently diverging (2026-08-01 user report: an approved
// contract's sqm reverting/disagreeing with its Opportunity and the list
// screens).
async function syncBoothFieldsAndMirror(client, companyId, recordType, recordId) {
  await recomputeCachedBoothFields(client, recordType, recordId);
  if (recordType === 'sales_order') {
    await mirrorContractToOpportunity(client, companyId, recordId);
  }
}

module.exports = { mirrorContractToOpportunity, syncBoothFieldsAndMirror };
