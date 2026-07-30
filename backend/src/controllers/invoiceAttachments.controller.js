const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { pool } = require('../config/db');
const { financeVisibilityClause } = require('../utils/visibility');

// Supporting documents Finance attaches when reviewing/confirming an
// invoice (bank slip, correspondence, etc.) — same disk-storage pattern as
// contract attachments (salesOrderAttachments.controller.js): random
// on-disk filename, original name never trusted as a path.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'invoices');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const random = crypto.randomBytes(16).toString('hex');
    cb(null, `${random}${path.extname(file.originalname)}`);
  },
});

// 5MB — plenty for a scanned/photographed slip or a PDF e-invoice once
// compressed; matches the limit already used for company branding uploads
// (settings.controller.js) elsewhere in the app.
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

async function listAttachments(req, res) {
  const vis = financeVisibilityClause(req, 'so.salesperson_id', 3);
  const result = await pool.query(
    `SELECT a.id, a.original_filename, a.mime_type, a.size_bytes, a.uploaded_at, u.full_name AS uploaded_by_name,
            a.doc_type, a.finance_acknowledged_at
     FROM invoice_attachments a
     JOIN invoices inv ON inv.id = a.invoice_id
     JOIN sales_orders so ON so.id = inv.sales_order_id
     LEFT JOIN users u ON u.id = a.uploaded_by
     WHERE a.invoice_id = $1 AND inv.company_id = $2 AND ${vis.sql}
     ORDER BY a.uploaded_at DESC`,
    [req.params.id, req.companyId, ...(vis.param !== undefined ? [vis.param] : [])]
  );
  res.json({ attachments: result.rows });
}

const DOC_TYPES = ['E_INVOICE', 'PAYMENT_PROOF', 'SUPPORTING_DOC'];

async function uploadAttachment(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const docType = DOC_TYPES.includes(req.body.doc_type) ? req.body.doc_type : 'SUPPORTING_DOC';

  const invCheck = await pool.query(
    `SELECT id FROM invoices WHERE id = $1 AND company_id = $2`,
    [req.params.id, req.companyId]
  );
  if (!invCheck.rows[0]) {
    fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: 'Invoice not found.' });
  }

  const result = await pool.query(
    `INSERT INTO invoice_attachments
       (invoice_id, original_filename, stored_filename, mime_type, size_bytes, uploaded_by, doc_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [req.params.id, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.userId, docType]
  );

  res.status(201).json({ attachment: { id: result.rows[0].id } });
}

// Finance dismisses the "a customer's proof of payment was attached" Task
// To-Do item — same explicit ack pattern as invoices.controller.js's
// acknowledgeConfirm, not an automatic on-page-view dismissal.
async function acknowledgePaymentProof(req, res) {
  if (req.roleCode !== 'FIN') {
    return res.status(403).json({ error: 'Only Finance can acknowledge this.' });
  }
  const result = await pool.query(
    `UPDATE invoice_attachments a SET finance_acknowledged_at = now(), finance_acknowledged_by = $1
     FROM invoices inv
     WHERE a.id = $2 AND a.invoice_id = $3 AND a.invoice_id = inv.id AND inv.company_id = $4
     RETURNING a.id`,
    [req.userId, req.params.attachmentId, req.params.id, req.companyId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Attachment not found.' });
  res.json({ success: true });
}

async function downloadAttachment(req, res) {
  const vis = financeVisibilityClause(req, 'so.salesperson_id', 3);
  const result = await pool.query(
    `SELECT a.original_filename, a.stored_filename, a.mime_type
     FROM invoice_attachments a
     JOIN invoices inv ON inv.id = a.invoice_id
     JOIN sales_orders so ON so.id = inv.sales_order_id
     WHERE a.id = $1 AND a.invoice_id = $2 AND inv.company_id = $3 AND ${vis.sql}`,
    [req.params.attachmentId, req.params.id, req.companyId, ...(vis.param !== undefined ? [vis.param] : [])]
  );

  const attachment = result.rows[0];
  if (!attachment) {
    return res.status(404).json({ error: 'Attachment not found.' });
  }

  const filePath = path.join(UPLOAD_DIR, attachment.stored_filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File is missing from storage.' });
  }

  res.download(filePath, attachment.original_filename);
}

async function deleteAttachment(req, res) {
  const result = await pool.query(
    `DELETE FROM invoice_attachments a
     USING invoices inv
     WHERE a.id = $1 AND a.invoice_id = $2 AND a.invoice_id = inv.id AND inv.company_id = $3
     RETURNING a.stored_filename`,
    [req.params.attachmentId, req.params.id, req.companyId]
  );

  const deleted = result.rows[0];
  if (!deleted) {
    return res.status(404).json({ error: 'Attachment not found.' });
  }

  fs.unlink(path.join(UPLOAD_DIR, deleted.stored_filename), () => {});
  res.json({ success: true });
}

module.exports = { listAttachments, uploadAttachment, downloadAttachment, deleteAttachment, acknowledgePaymentProof, upload };
