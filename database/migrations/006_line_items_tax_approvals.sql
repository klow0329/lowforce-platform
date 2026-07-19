-- Item 6: contract line items, tax codes, currency, approval workflow, attachments.

BEGIN;

-- Company-configurable tax codes (kept editable, but codes match the
-- Malaysian SST scheme the user specified so accounting export lines up).
CREATE TABLE tax_codes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL REFERENCES companies(id),
    code        TEXT NOT NULL,         -- e.g. SV-6, SV-8, NTS
    name        TEXT NOT NULL,
    rate_pct    NUMERIC(5,2) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (company_id, code)
);

-- Single-row-per-company settings; starts with just the fixed USD:MYR rate
-- the user specified, editable later rather than hardcoded in application code.
CREATE TABLE company_settings (
    company_id       UUID PRIMARY KEY REFERENCES companies(id),
    usd_to_myr_rate  NUMERIC(10,4) NOT NULL DEFAULT 4.0
);

-- Price list gains a BOOTH/OTHER category (from the product catalogue) and
-- a default tax code, both admin-editable, both used when a line item is
-- added to a contract.
ALTER TABLE price_list
  ADD COLUMN category TEXT NOT NULL DEFAULT 'OTHER',
  ADD COLUMN default_tax_code_id UUID REFERENCES tax_codes(id);

-- Contract line items - real per-item pricing, discount and tax, replacing
-- the single total_myr figure. sales_orders.total_myr becomes a computed
-- cache (still stored, but always recalculated server-side from these rows).
CREATE TABLE sales_order_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sales_order_id    UUID NOT NULL REFERENCES sales_orders(id),
    price_list_id     UUID REFERENCES price_list(id),   -- NULL for a fully custom line
    sales_item_code   TEXT NOT NULL,                     -- BAS/SSS/ESS/WOP/CUB/COC/LOD/MEP/BAD/SPO/OTH
    description       TEXT NOT NULL,                     -- full name; free text for CUB/OTH
    category          TEXT NOT NULL DEFAULT 'OTHER',      -- snapshot of price_list.category
    qty               NUMERIC(10,2) NOT NULL DEFAULT 1,   -- sqm for booth items, count for others
    unit_price        NUMERIC(12,2) NOT NULL DEFAULT 0,   -- in the contract's currency
    discount_type     TEXT,                               -- NULL, 'FLAT' or 'PERCENT'
    discount_value    NUMERIC(12,2),
    tax_code_id       UUID REFERENCES tax_codes(id),
    tax_rate_pct      NUMERIC(5,2) NOT NULL DEFAULT 0,     -- snapshot at line-save time
    subtotal          NUMERIC(12,2) NOT NULL DEFAULT 0,    -- qty * unit_price
    discount_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
    line_total        NUMERIC(12,2) NOT NULL DEFAULT 0,    -- subtotal - discount + tax
    sort_order        INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_sales_order_items_order ON sales_order_items(sales_order_id);

-- Signed-contract attachments, for audit/reference.
CREATE TABLE sales_order_attachments (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sales_order_id     UUID NOT NULL REFERENCES sales_orders(id),
    original_filename  TEXT NOT NULL,
    stored_filename    TEXT NOT NULL,   -- on-disk name (random, avoids collisions/traversal)
    mime_type          TEXT,
    size_bytes         INT,
    uploaded_by        UUID REFERENCES users(id),
    uploaded_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Company-configurable approval matrix - not hardcoded per company, per the
-- plan's standing design principle.
CREATE TABLE approval_rules (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id         UUID NOT NULL REFERENCES companies(id),
    trigger_type       TEXT NOT NULL,   -- NEW_CONTRACT, DISCOUNT_ABOVE_THRESHOLD, TAX_CHANGE, POST_APPROVAL_EDIT
    threshold_type     TEXT,            -- 'PERCENT' or 'AMOUNT', only for DISCOUNT_ABOVE_THRESHOLD
    threshold_value    NUMERIC(12,2),
    approver_role_code TEXT,            -- e.g. 'MGT' - role-based approver
    approver_user_id   UUID REFERENCES users(id), -- or a specific named approver
    sort_order         INT NOT NULL DEFAULT 0,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE approval_log (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sales_order_id     UUID NOT NULL REFERENCES sales_orders(id),
    action             TEXT NOT NULL,     -- SUBMITTED, APPROVED, REJECTED, CHANGES_REQUESTED
    actor_user_id      UUID REFERENCES users(id),
    notes              TEXT,
    flagged_tax_change BOOLEAN NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sales_orders
  ADD COLUMN currency        TEXT NOT NULL DEFAULT 'MYR',
  ADD COLUMN exchange_rate   NUMERIC(10,4) NOT NULL DEFAULT 1,
  ADD COLUMN status          TEXT NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN subtotal_myr    NUMERIC(12,2),
  ADD COLUMN tax_total_myr   NUMERIC(12,2);

COMMIT;
