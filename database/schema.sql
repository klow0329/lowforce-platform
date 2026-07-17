-- ============================================================================
-- LowForce Platform — Phase 1 Database Schema
-- PostgreSQL. Multi-tenant from day one: every business table carries
-- company_id; event-scoped tables also carry event_id.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Extensions
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid()

-- ----------------------------------------------------------------------------
-- 1. Companies (tenants) — the root of every other table
-- ----------------------------------------------------------------------------
CREATE TABLE companies (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,          -- used in URLs, e.g. one-international
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 2. Roles — company-configurable (Section 1.1 of the plan: not hardcoded)
--    A company defines its own roles/divisions rather than inheriting
--    One International's SALES/MKT/OPS/FIN/MGT/ADM structure.
-- ----------------------------------------------------------------------------
CREATE TABLE roles (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id   UUID NOT NULL REFERENCES companies(id),
    code         TEXT NOT NULL,                -- e.g. SALES, ADM, MGT
    name         TEXT NOT NULL,                -- e.g. "Sales Executive"
    permissions  JSONB NOT NULL DEFAULT '{}',  -- e.g. {"sales_access": true, "can_approve_discount": false}
    sort_order   INT NOT NULL DEFAULT 0,
    UNIQUE (company_id, code)
);

-- ----------------------------------------------------------------------------
-- 3. Users
-- ----------------------------------------------------------------------------
CREATE TABLE users (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id     UUID NOT NULL REFERENCES companies(id),
    role_id        UUID REFERENCES roles(id),
    email          TEXT NOT NULL,
    password_hash  TEXT NOT NULL,               -- bcrypt hash, never plain text
    full_name      TEXT NOT NULL,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, email)
);

-- ----------------------------------------------------------------------------
-- 4. Events — a company can run multiple concurrently (mirrors MIFB/MYFT/MCE)
-- ----------------------------------------------------------------------------
CREATE TABLE events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL REFERENCES companies(id),
    code        TEXT NOT NULL,                  -- e.g. MIFB26
    name        TEXT NOT NULL,                  -- e.g. "MIFB 2026"
    event_year  INT,
    start_date  DATE,
    end_date    DATE,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (company_id, code)
);

CREATE TABLE user_event_access (
    user_id    UUID NOT NULL REFERENCES users(id),
    event_id   UUID NOT NULL REFERENCES events(id),
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (user_id, event_id)
);

-- ----------------------------------------------------------------------------
-- 5. Global reference — countries (true universal reference, not per-company)
-- ----------------------------------------------------------------------------
CREATE TABLE countries (
    code  TEXT PRIMARY KEY,   -- ISO code, e.g. MY, SG, CN
    name  TEXT NOT NULL
);

-- ----------------------------------------------------------------------------
-- 6. Company-configurable reference tables
-- ----------------------------------------------------------------------------
CREATE TABLE agents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL REFERENCES companies(id),
    name        TEXT NOT NULL,
    comm_rate   NUMERIC(5,2) DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE segment_main (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL REFERENCES companies(id),
    code        TEXT NOT NULL,
    name        TEXT NOT NULL,
    UNIQUE (company_id, code)
);

CREATE TABLE segment_sub (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id       UUID NOT NULL REFERENCES companies(id),
    segment_main_id  UUID NOT NULL REFERENCES segment_main(id),
    code             TEXT NOT NULL,
    name             TEXT NOT NULL
);

-- Sales pipeline stages — company-configurable, replaces the old fixed
-- STG10 / STG40 / STG80 / WON / LOSE from the Excel/Power Apps version.
CREATE TABLE sales_stages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id),
    code            TEXT NOT NULL,
    name            TEXT NOT NULL,
    probability_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
    sort_order      INT NOT NULL DEFAULT 0,
    is_won          BOOLEAN NOT NULL DEFAULT FALSE,
    is_lost         BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (company_id, code)
);

-- AR aging buckets — company-configurable, replaces the fixed 30/60/90/120.
CREATE TABLE aging_buckets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL REFERENCES companies(id),
    label       TEXT NOT NULL,       -- e.g. "0-30 days"
    min_days    INT NOT NULL,
    max_days    INT,                 -- NULL = open-ended ("120+ days")
    sort_order  INT NOT NULL DEFAULT 0
);

-- ----------------------------------------------------------------------------
-- 7. Price list — company + event scoped
-- ----------------------------------------------------------------------------
CREATE TABLE price_list (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id       UUID NOT NULL REFERENCES companies(id),
    event_id         UUID NOT NULL REFERENCES events(id),
    booth_type       TEXT NOT NULL,       -- e.g. "Standard", "Raw Space"
    sales_item_code  TEXT NOT NULL,       -- e.g. "MEP", "Badge"
    description      TEXT,
    unit_price_myr   NUMERIC(12,2),
    unit_price_usd   NUMERIC(12,2)
);

-- ----------------------------------------------------------------------------
-- 8. Exhibitors — full detail, Billing "same as" logic, real segments child table
-- ----------------------------------------------------------------------------
CREATE TABLE exhibitors (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id            UUID NOT NULL REFERENCES companies(id),
    company_name          TEXT NOT NULL,
    company_name_chinese  TEXT,
    country_code          TEXT REFERENCES countries(code),
    agent_id              UUID REFERENCES agents(id),
    salesperson_id        UUID REFERENCES users(id),

    -- Company detail carried over from the Excel Exhibitor Master
    address               TEXT,
    postcode              TEXT,
    city                  TEXT,
    state                 TEXT,
    reg_no                TEXT,     -- MY CO REG NO
    tin_no                TEXT,
    sst_no                TEXT,
    website               TEXT,
    fax                   TEXT,
    halal_certified       BOOLEAN NOT NULL DEFAULT FALSE,

    contact1_name         TEXT,
    contact1_job_title    TEXT,
    contact1_phone        TEXT,
    contact1_email        TEXT,
    contact2_name         TEXT,
    contact2_job_title    TEXT,
    contact2_phone        TEXT,
    contact2_email        TEXT,

    -- Billing sub-record with "same as company" toggle (carried over from Power Apps design)
    billing_same_as_company  BOOLEAN NOT NULL DEFAULT TRUE,
    billing_name             TEXT,
    billing_address          TEXT,
    billing_country_code     TEXT REFERENCES countries(code),
    billing_email            TEXT,

    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_exhibitors_company ON exhibitors(company_id);

-- Real one-to-many segments table — no more fixed 6-column hack
CREATE TABLE exhibitor_segments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exhibitor_id     UUID NOT NULL REFERENCES exhibitors(id),
    segment_sub_id   UUID NOT NULL REFERENCES segment_sub(id)
);

-- ----------------------------------------------------------------------------
-- 9. Opportunities
-- ----------------------------------------------------------------------------
CREATE TABLE opportunities (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID NOT NULL REFERENCES companies(id),
    event_id            UUID NOT NULL REFERENCES events(id),
    exhibitor_id        UUID NOT NULL REFERENCES exhibitors(id),
    salesperson_id      UUID REFERENCES users(id),
    stage_id            UUID NOT NULL REFERENCES sales_stages(id),
    booth_sqm           NUMERIC(10,2),
    booth_type          TEXT,
    estimated_value_myr NUMERIC(12,2) NOT NULL DEFAULT 0,
    next_follow_up_date DATE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_opportunities_company_event ON opportunities(company_id, event_id);

-- ----------------------------------------------------------------------------
-- 10. Sales Orders (Contract Form output becomes one of these)
-- ----------------------------------------------------------------------------
CREATE TABLE sales_orders (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id        UUID NOT NULL REFERENCES companies(id),
    event_id          UUID NOT NULL REFERENCES events(id),
    exhibitor_id      UUID NOT NULL REFERENCES exhibitors(id),
    opportunity_id    UUID REFERENCES opportunities(id),
    salesperson_id    UUID REFERENCES users(id),
    contract_type     TEXT NOT NULL DEFAULT 'STANDARD', -- STANDARD or COEX (Contract Form - CoEX)
    contract_date     DATE,
    total_myr         NUMERIC(12,2),
    -- Carried over from the Excel per-salesperson tabs
    legacy_order_no   TEXT,      -- e.g. JL00001 — the Excel ORDER number, for traceability
    booking_type      TEXT,      -- e.g. EARLY BIRD, ONSITE REBOOKING, PUBLISHED RATE
    hall              TEXT,
    booth_no          TEXT,
    dimension         TEXT,      -- e.g. "3m x 3m"
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 11. Invoices, Payments / Official Receipts
--     (Proforma is a pre-invoice document generated from a sales_order before
--      an invoice exists — modeled as a document render, not a separate table,
--      since it carries no data an invoice/sales_order doesn't already have.)
-- ----------------------------------------------------------------------------
CREATE TABLE invoices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id),
    event_id        UUID NOT NULL REFERENCES events(id),
    sales_order_id  UUID NOT NULL REFERENCES sales_orders(id),
    exhibitor_id    UUID NOT NULL REFERENCES exhibitors(id),
    invoice_no      TEXT NOT NULL,
    invoice_date    DATE NOT NULL,
    amount_myr      NUMERIC(12,2) NOT NULL,
    UNIQUE (company_id, invoice_no)
);

CREATE TABLE payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id      UUID NOT NULL REFERENCES invoices(id),
    payment_date    DATE NOT NULL,
    amount_myr      NUMERIC(12,2) NOT NULL,
    payment_method  TEXT,
    bank_ref        TEXT,
    receipt_no      TEXT               -- Official Receipt number, generated on payment
);

-- ----------------------------------------------------------------------------
-- Notes on reports (Customer Aging, Sales Dashboard):
-- These are derived from the tables above via queries/views, not stored
-- separately — e.g. Customer Aging = invoices.amount_myr minus SUM(payments)
-- per invoice, bucketed by days-overdue using each company's own
-- aging_buckets. Views will be added once Phase 1 report screens are built.
-- ----------------------------------------------------------------------------
