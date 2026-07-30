const { releaseAllClaims } = require('./floorPlanClaims');

// Keeps a floor_plan_booths row in sync with whichever Opportunity/Contract
// it's picked for — called from inside the SAME transaction as that
// record's own create/update, so a booth only ever actually locks once the
// parent record save has genuinely succeeded (picking on the Floor Plan
// screen itself no longer touches the booth at all — see FloorPlan.jsx).
//
// linkColumn: 'opportunity_id' or 'sales_order_id' on floor_plan_booths.
// PROPOSED/SOLD are never stored — they're computed at read time from
// opportunity_id/sales_order_id (+ the linked contract's approval status,
// see listBooths in floorPlan.controller.js), so this never writes them.
// status here only ever means AVAILABLE or RESERVED — the one thing that's
// genuinely independent of any Opportunity/Contract link.
async function syncFloorPlanBooth(client, companyId, { linkColumn, linkId, floorPlanBoothId, exhibitorName }) {
  // Release whatever booth this record held before, if it's not the one
  // being committed now — e.g. the user picked a different booth and saved
  // again.
  await client.query(
    `UPDATE floor_plan_booths b
     SET status = 'AVAILABLE', ${linkColumn} = NULL, assigned_exhibitor_name = NULL, fascia_name = NULL
     FROM floor_plan_halls h
     WHERE b.hall_id = h.id AND h.company_id = $1
       AND b.${linkColumn} = $2
       AND ($3::uuid IS NULL OR b.id != $3)`,
    [companyId, linkId, floorPlanBoothId || null]
  );

  if (!floorPlanBoothId) return { ok: true };

  const target = await client.query(
    `SELECT b.id, b.status, b.${linkColumn} AS current_link
     FROM floor_plan_booths b
     JOIN floor_plan_halls h ON h.id = b.hall_id
     WHERE b.id = $1 AND h.company_id = $2`,
    [floorPlanBoothId, companyId]
  );
  const booth = target.rows[0];
  if (!booth) return { ok: false, error: 'That booth no longer exists.' };
  // Free means: this link column isn't already claimed by a DIFFERENT
  // record, and it isn't manually Reserved by Operations. Re-saving the
  // same record against the same booth it already holds is always fine.
  const alreadyMine = booth.current_link === linkId;
  if (!alreadyMine && (booth.current_link || booth.status === 'RESERVED')) {
    return { ok: false, error: 'That booth was taken by someone else in the meantime — please pick another.' };
  }

  await client.query(
    `UPDATE floor_plan_booths SET ${linkColumn} = $1, assigned_exhibitor_name = $2 WHERE id = $3`,
    [linkId, exhibitorName || null, floorPlanBoothId]
  );
  return { ok: true };
}

// Releases whichever booth a record holds, with no replacement — used when
// an Opportunity is marked Lost (see OpportunityDetail.jsx's movingToLost),
// a Contract is Voided, or a Credit Note releases booths.
async function releaseFloorPlanBooth(client, companyId, linkColumn, linkId) {
  await client.query(
    `UPDATE floor_plan_booths b
     SET status = 'AVAILABLE', ${linkColumn} = NULL, assigned_exhibitor_name = NULL, fascia_name = NULL
     FROM floor_plan_halls h
     WHERE b.hall_id = h.id AND h.company_id = $1 AND b.${linkColumn} = $2`,
    [companyId, linkId]
  );
  // A booth released here might still be claimed by ANOTHER Opportunity/
  // draft Contract (competing-claims rule, Round 6 item 4) — re-derive the
  // primary display claimant from whoever's left instead of leaving it
  // wrongly blank when someone else is still proposing it.
  const recordType = linkColumn === 'sales_order_id' ? 'sales_order' : 'opportunity';
  await releaseAllClaims(client, companyId, recordType, linkId, 'RECORD_RELEASED');
}

module.exports = { syncFloorPlanBooth, releaseFloorPlanBooth };
