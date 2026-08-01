const { pool } = require('../config/db');
const { releaseFloorPlanBooth } = require('../utils/floorPlanSync');

// Admin-only reversible archive/delete (item 1 of a round of feedback) —
// data created by user or system error can sit around confusing other
// users, but real accounting/audit records should never be truly destroyed.
// Archiving just flips is_active off (hides it from every normal list —
// exhibitors/opportunities/sales_orders already filtered on this column,
// they just never had a UI to set it false; invoices/credit_notes/payments
// got a fresh is_active column for this) and records who/when/why;
// restoring flips it back. Blocked with a clear reason if something else
// still depends on the record, so nothing is ever silently orphaned.
const ENTITIES = {
  exhibitor: {
    table: 'exhibitors',
    label: (r) => r.company_name,
    dependencies: [
      { label: 'opportunity', sql: `SELECT COUNT(*) FROM opportunities WHERE exhibitor_id = $1 AND is_active = TRUE` },
      { label: 'contract', sql: `SELECT COUNT(*) FROM sales_orders WHERE exhibitor_id = $1 AND is_active = TRUE` },
      { label: 'invoice', sql: `SELECT COUNT(*) FROM invoices WHERE exhibitor_id = $1 AND is_active = TRUE` },
      { label: 'payment', sql: `SELECT COUNT(*) FROM payments WHERE exhibitor_id = $1 AND is_active = TRUE` },
    ],
  },
  opportunity: {
    table: 'opportunities',
    label: (r) => r.remarks || r.id,
    dependencies: [
      { label: 'contract', sql: `SELECT COUNT(*) FROM sales_orders WHERE opportunity_id = $1 AND status != 'VOID' AND is_active = TRUE` },
    ],
    // Any booth this record still holds must be released the moment it's
    // archived — otherwise the Floor Plan keeps showing it assigned and the
    // exhibitor's old billing keeps counting in reports even though the
    // record itself is hidden everywhere else (2026-07-31 bug report:
    // deleted EATS365 opportunity, booths 6004/6008 stayed shown as taken).
    // Mirrors the same release used by Void/Lost/Credit Note.
    boothLinkColumn: 'opportunity_id',
  },
  contract: {
    table: 'sales_orders',
    label: (r) => r.id,
    dependencies: [
      { label: 'invoice', sql: `SELECT COUNT(*) FROM invoices WHERE sales_order_id = $1 AND is_active = TRUE` },
      // Archiving out from under a still-pending Credit Note/Contract
      // Reduction request would leave it permanently un-actionable — nobody
      // could approve or reject it since the contract it's against no
      // longer exists anywhere the approver can see (2026-07-31 user
      // request: deleting a record should never leave orphaned linked data
      // behind, including in-flight approval workflows).
      { label: 'pending credit note', sql: `SELECT COUNT(*) FROM credit_notes WHERE sales_order_id = $1 AND status = 'PENDING_APPROVAL'` },
      { label: 'pending contract reduction', sql: `SELECT COUNT(*) FROM contract_reductions WHERE sales_order_id = $1 AND status = 'PENDING_APPROVAL'` },
    ],
    boothLinkColumn: 'sales_order_id',
  },
  invoice: {
    table: 'invoices',
    label: (r) => r.invoice_no,
    dependencies: [
      {
        label: 'payment allocation',
        sql: `SELECT COUNT(*) FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id WHERE pa.invoice_id = $1 AND p.is_active = TRUE`,
      },
      { label: 'credit note', sql: `SELECT COUNT(*) FROM credit_notes WHERE invoice_id = $1 AND is_active = TRUE` },
    ],
  },
  creditnote: {
    table: 'credit_notes',
    label: (r) => r.cn_no || r.id,
    dependencies: [],
    // Only a request that never actually took effect can be archived this
    // way — Sales already has a proper Withdraw for a still-pending one;
    // once it's Confirmed it has genuinely changed AR and can't be undone
    // by just hiding the row.
    extraCheck: (row) => (['DRAFT', 'REJECTED'].includes(row.status)
      ? null
      : `Cannot delete a ${row.status.replace('_', ' ').toLowerCase()} credit note — it has already taken effect. Withdraw it first if it's still pending approval.`),
  },
  payment: {
    table: 'payments',
    label: (r) => r.receipt_no || r.id,
    dependencies: [
      { label: 'invoice allocation', sql: `SELECT COUNT(*) FROM payment_allocations WHERE payment_id = $1` },
    ],
  },
};

async function archiveRecord(req, res) {
  const { type, id } = req.params;
  const entity = ENTITIES[type];
  if (!entity) return res.status(400).json({ error: 'Unknown record type.' });
  const reason = (req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A reason is required.' });

  const existing = await pool.query(`SELECT * FROM ${entity.table} WHERE id = $1 AND company_id = $2`, [id, req.companyId]);
  const row = existing.rows[0];
  if (!row) return res.status(404).json({ error: 'Record not found.' });
  if (row.is_active === false) return res.status(400).json({ error: 'This record is already deleted.' });

  if (entity.extraCheck) {
    const blockedReason = entity.extraCheck(row);
    if (blockedReason) return res.status(409).json({ error: blockedReason });
  }

  for (const dep of entity.dependencies) {
    const depResult = await pool.query(dep.sql, [id]);
    const count = Number(depResult.rows[0].count);
    if (count > 0) {
      return res.status(409).json({
        error: `Cannot delete — still has ${count} ${dep.label}${count === 1 ? '' : 's'} attached. Delete or reassign ${count === 1 ? 'it' : 'those'} first.`,
      });
    }
  }

  if (entity.boothLinkColumn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE ${entity.table} SET is_active = FALSE, deleted_by = $1, deleted_at = now(), delete_reason = $2 WHERE id = $3`,
        [req.userId, reason, id]
      );
      await releaseFloorPlanBooth(client, req.companyId, entity.boothLinkColumn, id);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    await pool.query(
      `UPDATE ${entity.table} SET is_active = FALSE, deleted_by = $1, deleted_at = now(), delete_reason = $2 WHERE id = $3`,
      [req.userId, reason, id]
    );
  }
  res.json({ success: true });
}

async function restoreRecord(req, res) {
  const { type, id } = req.params;
  const entity = ENTITIES[type];
  if (!entity) return res.status(400).json({ error: 'Unknown record type.' });

  const result = await pool.query(
    `UPDATE ${entity.table} SET is_active = TRUE, deleted_by = NULL, deleted_at = NULL, delete_reason = NULL
     WHERE id = $1 AND company_id = $2 RETURNING id`,
    [id, req.companyId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Record not found.' });
  res.json({ success: true });
}

async function listArchived(req, res) {
  const { type } = req.params;
  const entity = ENTITIES[type];
  if (!entity) return res.status(400).json({ error: 'Unknown record type.' });

  const result = await pool.query(
    `SELECT t.*, u.full_name AS deleted_by_name
     FROM ${entity.table} t
     LEFT JOIN users u ON u.id = t.deleted_by
     WHERE t.company_id = $1 AND t.is_active = FALSE
     ORDER BY t.deleted_at DESC NULLS LAST`,
    [req.companyId]
  );
  res.json({ records: result.rows.map((r) => ({ ...r, _label: entity.label(r) })) });
}

module.exports = { archiveRecord, restoreRecord, listArchived };
