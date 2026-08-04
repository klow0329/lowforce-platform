const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { pool } = require('../config/db');
const { financeVisibilityClause } = require('../utils/visibility');

// Supporting documents Finance attaches when reviewing/confirming a credit
// note — exact mirror of invoiceAttachments.controller.js.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'credit-notes');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const random = crypto.randomBytes(16).toString('hex');
    cb(null, `${random}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB — matches every other attachment type in the app
});

async function listAttachments(req, res) {
  const vis = financeVisibilityClause(req, 'so.salesperson_id', 3);
  const result = await pool.query(
    `SELECT a.id, a.original_filename, a.mime_type, a.size_bytes, a.uploaded_at, u.full_name AS uploaded_by_name
     FROM credit_note_attachments a
     JOIN credit_notes cn ON cn.id = a.credit_note_id
     JOIN sales_orders so ON so.id = cn.sales_order_id
     LEFT JOIN users u ON u.id = a.uploaded_by
     WHERE a.credit_note_id = $1 AND cn.company_id = $2 AND ${vis.sql}
     ORDER BY a.uploaded_at DESC`,
    [req.params.id, req.companyId, ...(vis.param !== undefined ? [vis.param] : [])]
  );
  res.json({ attachments: result.rows });
}

async function uploadAttachment(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const cnCheck = await pool.query(
    `SELECT id FROM credit_notes WHERE id = $1 AND company_id = $2`,
    [req.params.id, req.companyId]
  );
  if (!cnCheck.rows[0]) {
    fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: 'Credit note not found.' });
  }

  const result = await pool.query(
    `INSERT INTO credit_note_attachments
       (credit_note_id, original_filename, stored_filename, mime_type, size_bytes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [req.params.id, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.userId]
  );

  res.status(201).json({ attachment: { id: result.rows[0].id } });
}

async function downloadAttachment(req, res) {
  const vis = financeVisibilityClause(req, 'so.salesperson_id', 3);
  const result = await pool.query(
    `SELECT a.original_filename, a.stored_filename, a.mime_type, cn.cn_no
     FROM credit_note_attachments a
     JOIN credit_notes cn ON cn.id = a.credit_note_id
     JOIN sales_orders so ON so.id = cn.sales_order_id
     WHERE a.id = $1 AND a.credit_note_id = $2 AND cn.company_id = $3 AND ${vis.sql}`,
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

  // Prefixed with the CN number so a downloaded file is unambiguously
  // identifiable as belonging to this credit note (not an invoice or
  // contract) once it's sitting in someone's Downloads folder — per the
  // user's explicit request (2026-07-31): "not sure where is CN" when
  // browsing attachments outside the app.
  const downloadName = `${attachment.cn_no} - ${attachment.original_filename}`;

  res.download(filePath, downloadName);
}

async function deleteAttachment(req, res) {
  const result = await pool.query(
    `DELETE FROM credit_note_attachments a
     USING credit_notes cn
     WHERE a.id = $1 AND a.credit_note_id = $2 AND a.credit_note_id = cn.id AND cn.company_id = $3
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

module.exports = { listAttachments, uploadAttachment, downloadAttachment, deleteAttachment, upload };
