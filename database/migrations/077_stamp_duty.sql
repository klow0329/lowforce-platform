-- Admin-configurable Stamp Duty — off by default for every company (new and
-- existing), so a fresh company never sees it until an Admin deliberately
-- turns it on and confirms the correct rate for their own jurisdiction (the
-- 0.5% / round-to-RM5 / RM10-minimum defaults here are the user's own
-- stated starting point, NOT independently verified against LHDN — see
-- PROJECT_LOG.md). Fully editable via Admin > Company Profile; nothing here
-- is hardcoded into application logic.
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS stamp_duty_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS stamp_duty_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 0.5;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS stamp_duty_round_to NUMERIC(10,2) NOT NULL DEFAULT 5;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS stamp_duty_minimum NUMERIC(10,2) NOT NULL DEFAULT 10;
