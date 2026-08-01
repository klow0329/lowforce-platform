const { pool } = require('../config/db');

const TEMPLATE_KEYS = ['TAX_DETAIL_LINK', 'STATEMENT_OF_ACCOUNT', 'OUTSTANDING_REMINDER', 'USER_INVITE'];

// Only Admin/Management may change the company's own wording — everyone
// else (Sales drafting a tax-detail email, Finance drafting a reminder)
// just reads whichever template is currently saved.
const CAN_EDIT_ROLES = ['ADM', 'MGT'];

async function listTemplates(req, res) {
  const result = await pool.query(
    `SELECT template_key, subject, body, updated_at FROM email_templates WHERE company_id = $1`,
    [req.companyId]
  );
  res.json({ templates: result.rows });
}

async function getTemplate(req, res) {
  const { key } = req.params;
  if (!TEMPLATE_KEYS.includes(key)) {
    return res.status(400).json({ error: 'Unknown template key.' });
  }
  const result = await pool.query(
    `SELECT template_key, subject, body FROM email_templates WHERE company_id = $1 AND template_key = $2`,
    [req.companyId, key]
  );
  if (!result.rows[0]) {
    return res.status(404).json({ error: 'Template not found — ask Admin to set it up.' });
  }
  res.json({ template: result.rows[0] });
}

async function updateTemplate(req, res) {
  if (!CAN_EDIT_ROLES.includes(req.roleCode)) {
    return res.status(403).json({ error: 'Only Admin/Management can edit email templates.' });
  }
  const { key } = req.params;
  if (!TEMPLATE_KEYS.includes(key)) {
    return res.status(400).json({ error: 'Unknown template key.' });
  }
  const { subject, body } = req.body;
  if (!subject || !body) {
    return res.status(400).json({ error: 'Subject and body are required.' });
  }
  const result = await pool.query(
    `INSERT INTO email_templates (company_id, template_key, subject, body, updated_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (company_id, template_key) DO UPDATE
       SET subject = EXCLUDED.subject, body = EXCLUDED.body, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING template_key, subject, body`,
    [req.companyId, key, subject, body, req.userId]
  );
  res.json({ template: result.rows[0] });
}

module.exports = { listTemplates, getTemplate, updateTemplate, TEMPLATE_KEYS };
