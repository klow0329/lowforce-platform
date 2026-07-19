const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { pool } = require('../config/db');
const { visibilityClause } = require('../utils/visibility');

// Signed contracts for audit/reference — stored on disk under backend/uploads
// (gitignored), one random filename per upload so nothing collides and the
// original name is never trusted as a path.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'contracts');
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
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB — signed PDFs/scans, not video
});

async function listAttachments(req, res) {
  const vis = visibilityClause(req, 'so.salesperson_id', 3);
  const result = await pool.query(
    `SELECT a.id, a.original_filename, a.mime_type, a.size_bytes, a.uploaded_at, u.full_name AS uploaded_by_name
     FROM sales_order_attachments a
     JOIN sales_orders so ON so.id = a.sales_order_id
     LEFT JOIN users u ON u.id = a.uploaded_by
     WHERE a.sales_order_id = $1 AND so.company_id = $2 AND ${vis.sql}
     ORDER BY a.uploaded_at DESC`,
    [req.params.id, req.companyId, ...(vis.param !== undefined ? [vis.param] : [])]
  );
  res.json({ attachments: result.rows });
}

async function uploadAttachment(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const soCheck = await pool.query(
    `SELECT id FROM sales_orders WHERE id = $1 AND company_id = $2`,
    [req.params.id, req.companyId]
  );
  if (!soCheck.rows[0]) {
    fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: 'Contract not found.' });
  }

  const result = await pool.query(
    `INSERT INTO sales_order_attachments
       (sales_order_id, original_filename, stored_filename, mime_type, size_bytes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [req.params.id, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.userId]
  );

  res.status(201).json({ attachment: { id: result.rows[0].id } });
}

async function downloadAttachment(req, res) {
  const vis = visibilityClause(req, 'so.salesperson_id', 3);
  const result = await pool.query(
    `SELECT a.original_filename, a.stored_filename, a.mime_type
     FROM sales_order_attachments a
     JOIN sales_orders so ON so.id = a.sales_order_id
     WHERE a.id = $1 AND a.sales_order_id = $2 AND so.company_id = $3 AND ${vis.sql}`,
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
    `DELETE FROM sales_order_attachments a
     USING sales_orders so
     WHERE a.id = $1 AND a.sales_order_id = $2 AND a.sales_order_id = so.id AND so.company_id = $3
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
