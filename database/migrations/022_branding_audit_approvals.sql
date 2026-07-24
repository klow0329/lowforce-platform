-- Productization round: per-company branding images for official documents,
-- an append-only audit trail, and approval-matrix cleanup.

BEGIN;

-- 1. Branding images (logo / letterhead header / footer) — per company,
--    rendered on every official printed document (Contract, Proforma,
--    Invoice, Receipt, Statement).
ALTER TABLE company_settings
  ADD COLUMN logo_filename TEXT,
  ADD COLUMN letterhead_filename TEXT,
  ADD COLUMN footer_filename TEXT;

-- 2. Audit trail — append-only, one row per successful state-changing
--    request plus explicit auth events. user_name/role_code are snapshots
--    so the trail stays meaningful even if the user is renamed/deactivated.
CREATE TABLE audit_log (
    id           BIGSERIAL PRIMARY KEY,
    company_id   UUID NOT NULL REFERENCES companies(id),
    user_id      UUID,
    user_name    TEXT,
    role_code    TEXT,
    action       TEXT NOT NULL,      -- LOGIN / FAILED_LOGIN / POST / PUT / DELETE ...
    entity_type  TEXT NOT NULL,      -- e.g. sales-orders, invoices, payments, auth
    entity_id    TEXT,
    details      JSONB,              -- request path + redacted payload / context
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_company_time ON audit_log(company_id, created_at DESC);
CREATE INDEX idx_audit_log_entity ON audit_log(company_id, entity_type, entity_id);

-- 3. Approval matrix: TAX_CHANGE retires — a tax change on an approved
--    contract is just one kind of post-approval edit, which
--    POST_APPROVAL_EDIT already covers.
UPDATE approval_rules SET is_active = FALSE WHERE trigger_type = 'TAX_CHANGE';

COMMIT;
