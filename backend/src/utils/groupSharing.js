const { pool } = require('../config/db');

// Which OTHER companies' records this user may see in a group-wide search.
//
// SECURITY-CRITICAL, so read the rules carefully before changing anything:
//
//  1. The group is always DERIVED from the caller's own company
//     (user -> company -> group). It is never accepted as a parameter.
//     A client-supplied group id would let a crafted request reach another
//     customer's data — the exact failure mode multi-tenancy exists to
//     prevent.
//  2. Sharing is RECIPROCAL: you only see peers if YOUR company also
//     shares. Otherwise a company could harvest the whole group's contact
//     list while exposing nothing of its own.
//  3. A company with no group (group_id IS NULL) never sees anyone else,
//     and standalone companies are unaffected entirely.
//  4. This returns companies to READ in search only. It must never be
//     spliced into a write path, or into the per-record fetch — opening
//     another company's record stays hard-blocked by the usual
//     `company_id = $n` filter.
//
// resourceType is a plain string ('EXHIBITORS' today, 'VENDORS' planned)
// so a new shared resource needs no schema or helper change.
async function getGroupSharedCompanyIds(companyId, resourceType, client = pool) {
  const result = await client.query(
    `WITH me AS (
       SELECT c.id, c.group_id
       FROM companies c
       WHERE c.id = $1
     )
     SELECT peer.id
     FROM me
     JOIN companies peer
       ON peer.group_id = me.group_id
      AND peer.id <> me.id
     JOIN company_group_sharing peer_share
       ON peer_share.company_id = peer.id
      AND peer_share.resource_type = $2
      AND peer_share.is_shared = TRUE
     WHERE me.group_id IS NOT NULL
       -- Reciprocity: my own company must be sharing too.
       AND EXISTS (
         SELECT 1 FROM company_group_sharing mine
         WHERE mine.company_id = me.id
           AND mine.resource_type = $2
           AND mine.is_shared = TRUE
       )`,
    [companyId, resourceType]
  );
  return result.rows.map((r) => r.id);
}

async function isSharingEnabled(companyId, resourceType, client = pool) {
  const result = await client.query(
    `SELECT is_shared FROM company_group_sharing WHERE company_id = $1 AND resource_type = $2`,
    [companyId, resourceType]
  );
  return result.rows[0]?.is_shared === true;
}

async function setSharing(companyId, resourceType, isShared, userId, client = pool) {
  await client.query(
    `INSERT INTO company_group_sharing (company_id, resource_type, is_shared, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (company_id, resource_type)
       DO UPDATE SET is_shared = EXCLUDED.is_shared, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [companyId, resourceType, !!isShared, userId]
  );
}

module.exports = { getGroupSharedCompanyIds, isSharingEnabled, setSharing };
