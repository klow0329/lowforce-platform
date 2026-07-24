-- Sales targets per salesperson per event (MYR + sqm) — powers the Reports
-- module's Target vs Achieved figures. Company-configurable data, not code
-- (standing rule #2): the Excel DATA tab's hardcoded 3M/4M/2M per-person
-- targets become editable rows here.

BEGIN;

CREATE TABLE sales_targets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL REFERENCES companies(id),
    event_id    UUID NOT NULL REFERENCES events(id),
    user_id     UUID NOT NULL REFERENCES users(id),
    target_myr  NUMERIC(14,2) NOT NULL DEFAULT 0,
    target_sqm  NUMERIC(10,2) NOT NULL DEFAULT 0,
    UNIQUE (company_id, event_id, user_id)
);

CREATE INDEX idx_sales_targets_event ON sales_targets(company_id, event_id);

COMMIT;
