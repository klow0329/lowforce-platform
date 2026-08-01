-- New-user invite wording for the Admin > Data Import > Users tool — drafted
-- via the same copy-into-Outlook pattern as the other email_templates
-- (see EmailDraftPanel.jsx), since this platform has no server-side email
-- sending (standing rule: custom-built auth, no vendor).
INSERT INTO email_templates (company_id, template_key, subject, body)
SELECT id, 'USER_INVITE', 'Your LowForce Account — {{company_name}}',
E'Dear {{full_name}},\n\nAn account has been set up for you on LowForce.\n\nEmail: {{email}}\nTemporary Password: {{temp_password}}\n\nPlease log in and change your password on first use.\n\nThank you,\n{{sender_name}}\n{{company_name}}'
FROM companies;
