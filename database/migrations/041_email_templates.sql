-- Company-configurable wording for the emails Sales/Finance draft from
-- LowForce (Tax Detail Link, Statement of Account, Outstanding Reminder,
-- and any future ones) — per the user's explicit ask for wording control,
-- not hardcoded copy. {{token}} placeholders are substituted client-side
-- when the draft is composed (see EmailDraftPanel.jsx); unused tokens are
-- left as literal text if a screen doesn't happen to supply that value.
CREATE TABLE email_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id),
  template_key  TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  updated_by    UUID REFERENCES users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, template_key)
);

INSERT INTO email_templates (company_id, template_key, subject, body)
SELECT id, 'TAX_DETAIL_LINK', 'Complete Your Company Details — {{company_name}}',
E'Dear {{exhibitor_name}},\n\nTo prepare your Contract, please complete your company''s tax and contact details using the secure link below. This link is valid for {{expiry_days}} days and can only be used once.\n\n{{link}}\n\nThank you,\n{{sender_name}}\n{{company_name}}'
FROM companies;

INSERT INTO email_templates (company_id, template_key, subject, body)
SELECT id, 'STATEMENT_OF_ACCOUNT', 'Statement of Account — {{exhibitor_name}}',
E'Dear {{exhibitor_name}},\n\nPlease find attached your Statement of Account as at {{as_of_date}}. Your current outstanding balance is {{balance_amount}}.\n\nPlease let us know if you have any questions.\n\nThank you,\n{{sender_name}}\n{{company_name}}'
FROM companies;

INSERT INTO email_templates (company_id, template_key, subject, body)
SELECT id, 'OUTSTANDING_REMINDER', 'Payment Reminder — {{exhibitor_name}}',
E'Dear {{exhibitor_name}},\n\nThis is a friendly reminder that you currently have an outstanding balance of {{balance_amount}} for invoice {{invoice_no}}, due on {{due_date}}.\n\nKindly arrange payment at your earliest convenience. Please contact us if you have already made payment or need any assistance.\n\nThank you,\n{{sender_name}}\n{{company_name}}'
FROM companies;
