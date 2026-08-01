const { pool } = require('../config/db');

// Resolves whichever sales_item_code the event's Price List has flagged
// is_primary_base (see priceList.controller.js's cascadePrimaryBase) —
// falls back to the literal 'BAS' for any event that predates this feature
// or hasn't had its Price List set up yet, so behavior is unchanged until
// an admin deliberately reconfigures it.
async function getPrimaryBaseCode(companyId, eventId, client = pool) {
  const result = await client.query(
    `SELECT sales_item_code FROM price_list WHERE company_id = $1 AND event_id = $2 AND is_primary_base = true LIMIT 1`,
    [companyId, eventId]
  );
  return result.rows[0]?.sales_item_code || 'BAS';
}

// Every sales_item_code an event's Price List flags as physically tied to a
// booth — the primary base item itself, every Upgrade tier, and every
// is_booth_related addon (Corner/Loading, or any company-added one — see
// migration 069). Used to decide which billing rows a Contract's booth
// changes should mirror onto its linked Opportunity (see
// utils/opportunitySync.js) — MEP/Sponsorship/Other/Badge are deliberately
// excluded since they're independent per-record manual decisions, not
// derived from the booths at all.
async function getBoothDrivenCodes(companyId, eventId, client = pool) {
  const primaryBase = await getPrimaryBaseCode(companyId, eventId, client);
  const result = await client.query(
    `SELECT DISTINCT sales_item_code FROM price_list
     WHERE company_id = $1 AND event_id = $2 AND (is_upgrade_option = true OR is_booth_related = true)`,
    [companyId, eventId]
  );
  return [...new Set([primaryBase, ...result.rows.map((r) => r.sales_item_code)])];
}

module.exports = { getPrimaryBaseCode, getBoothDrivenCodes };
