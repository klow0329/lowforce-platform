// Booth "claims" let more than one Opportunity/draft Contract propose the
// same still-unsold booth at once (Round 6 item 4) — floor_plan_booths' own
// opportunity_id/sales_order_id columns can only ever hold ONE record each,
// so they now mean "the currently displayed/primary claimant" (drives
// computed_status, the Contracts-list booth tracker, print pages — nothing
// there changes), while floor_plan_booth_claims is the real multi-claim
// source of truth that listRecordBooths/bulkSetRecordBooths read from.
// These helpers keep the two in sync any time a claim is added or released.

// Recomputes the primary column for each given booth from whichever active
// claim is oldest, or clears the booth back to fully available if none
// remain — call this after ANY claim is added or released, so the primary
// slot always tracks who's actually still claiming it.
async function promotePrimaryClaimants(client, boothIds) {
  if (!boothIds || boothIds.length === 0) return;
  const winners = await client.query(
    `SELECT DISTINCT ON (booth_id) booth_id, record_type, record_id
     FROM floor_plan_booth_claims
     WHERE booth_id = ANY($1::uuid[]) AND released_at IS NULL
     ORDER BY booth_id, claimed_at ASC`,
    [boothIds]
  );
  const winnerByBoothId = new Map(winners.rows.map((w) => [w.booth_id, w]));
  for (const boothId of boothIds) {
    const winner = winnerByBoothId.get(boothId);
    if (winner) {
      const col = winner.record_type === 'sales_order' ? 'sales_order_id' : 'opportunity_id';
      const otherCol = winner.record_type === 'sales_order' ? 'opportunity_id' : 'sales_order_id';
      await client.query(`UPDATE floor_plan_booths SET ${col} = $1, ${otherCol} = NULL WHERE id = $2`, [winner.record_id, boothId]);
    } else {
      await client.query(
        `UPDATE floor_plan_booths SET opportunity_id = NULL, sales_order_id = NULL, assigned_exhibitor_name = NULL, fascia_name = NULL WHERE id = $1`,
        [boothId]
      );
    }
  }
}

// Marks one record's active claim on one booth as released, then re-derives
// that booth's primary claimant from whoever's left.
async function releaseClaim(client, boothId, recordType, recordId, reason) {
  await client.query(
    `UPDATE floor_plan_booth_claims SET released_at = now(), release_reason = $1
     WHERE booth_id = $2 AND record_type = $3 AND record_id = $4 AND released_at IS NULL`,
    [reason, boothId, recordType, recordId]
  );
  await promotePrimaryClaimants(client, [boothId]);
}

// Releases EVERY active claim a record holds, across all its booths — used
// when an Opportunity is marked Lost, a Contract is Voided, or a Credit
// Note releases booths.
async function releaseAllClaims(client, companyId, recordType, recordId, reason) {
  const affected = await client.query(
    `UPDATE floor_plan_booth_claims c SET released_at = now(), release_reason = $1
     FROM floor_plan_booths b JOIN floor_plan_halls h ON h.id = b.hall_id
     WHERE c.booth_id = b.id AND h.company_id = $2
       AND c.record_type = $3 AND c.record_id = $4 AND c.released_at IS NULL
     RETURNING c.booth_id`,
    [reason, companyId, recordType, recordId]
  );
  await promotePrimaryClaimants(client, affected.rows.map((r) => r.booth_id));
}

// Mirrors a record's current active claims onto its own Hall/Booth No/Total
// Sqm columns — so anything reading those columns directly (list screens,
// print docs) is correct immediately, not just once the user's next Save
// happens to run. Used both by the booth picker's "OK" commit and by
// approveSalesOrder when a losing claimant's booth set shrinks.
async function recomputeCachedBoothFields(client, recordType, recordId) {
  const parentTable = recordType === 'sales_order' ? 'sales_orders' : 'opportunities';
  const rows = await client.query(
    `SELECT h.name AS hall_name, b.booth_no, b.sqm
     FROM floor_plan_booth_claims c
     JOIN floor_plan_booths b ON b.id = c.booth_id
     JOIN floor_plan_halls h ON h.id = b.hall_id
     WHERE c.record_type = $1 AND c.record_id = $2 AND c.released_at IS NULL
     ORDER BY h.name, b.booth_no`,
    [recordType, recordId]
  );
  const hallNames = [...new Set(rows.rows.map((r) => r.hall_name).filter(Boolean))];
  const hall = hallNames.length === 0 ? null : (hallNames.length === 1 ? hallNames[0] : 'Multi');
  const boothNo = rows.rows.length === 0 ? null : rows.rows.map((r) => r.booth_no).join(', ');
  const totalSqm = rows.rows.reduce((sum, r) => sum + (Number(r.sqm) || 0), 0);
  await client.query(`UPDATE ${parentTable} SET hall = $1, booth_no = $2, total_sqm = $3 WHERE id = $4`, [hall, boothNo, totalSqm, recordId]);
}

module.exports = { promotePrimaryClaimants, releaseClaim, releaseAllClaims, recomputeCachedBoothFields };
