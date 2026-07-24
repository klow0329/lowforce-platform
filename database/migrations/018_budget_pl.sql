-- Budget / LE / Actual P&L module — skeleton first pass, per the user's own
-- real MIFB26 PL Excel: a Budget sheet (Revenue + Expense lines, grouped
-- into sections) and a separate actual-expenses ledger Finance imports
-- into, linked by GL/expense code. See memory budget-pl-module-plan.md for
-- the full mapping this was built from.

BEGIN;

-- Admin-managed reference list of expense codes — starts empty on purpose
-- (user: "Management will set a new GL code for it, we can set it later"),
-- same CRUD pattern as tax_codes.
CREATE TABLE expense_codes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL REFERENCES companies(id),
    code        TEXT NOT NULL,
    description TEXT NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (company_id, code)
);

-- One budget per event. Budget amounts are fixed once APPROVED — ongoing
-- revisions after that go through the LE (Latest Estimate) column instead,
-- per the user's own description of how this already works on paper.
CREATE TABLE budgets (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id       UUID NOT NULL REFERENCES companies(id),
    event_id         UUID NOT NULL REFERENCES events(id),
    status           TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT | PENDING_APPROVAL | APPROVED
    preparer_user_id UUID REFERENCES users(id),
    approver_user_id UUID REFERENCES users(id),
    submitted_at     TIMESTAMPTZ,
    approved_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, event_id)
);

-- Revenue lines tie to a real sales-item code (BAS/SSS/ESS/WOP/CUB/COR/LOD/
-- MEP/BAD/SPO/OTH) so Actual Revenue computes from real Opportunity/
-- Contract data. Expense lines tie to an expense_code instead. Expense
-- budget/LE amounts are stored NEGATIVE, matching the reference Excel's own
-- sign convention, so a Finance person reading this recognizes it.
CREATE TABLE budget_lines (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_id        UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    line_type        TEXT NOT NULL,        -- REVENUE | EXPENSE
    section          TEXT NOT NULL,        -- e.g. 'SITE EXPENSES', 'REVENUE'
    sales_item_code  TEXT,                 -- set for REVENUE lines
    expense_code_id  UUID REFERENCES expense_codes(id), -- set for EXPENSE lines
    description      TEXT NOT NULL,
    budget_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
    le_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
    comments         TEXT,
    sort_order        INTEGER NOT NULL DEFAULT 0
);

-- The actual-expense transaction ledger — Finance's import target. A
-- budget line's Actual = SUM(amount) for its expense_code, computed live
-- (never stored), same mechanism as the reference Excel's SUMIF against its
-- own COGS sheet.
CREATE TABLE actual_expense_entries (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id        UUID NOT NULL REFERENCES companies(id),
    event_id          UUID NOT NULL REFERENCES events(id),
    expense_code_id   UUID NOT NULL REFERENCES expense_codes(id),
    entry_date        DATE,
    reference         TEXT,
    description       TEXT,
    amount            NUMERIC(14,2) NOT NULL,
    created_by_user_id UUID REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_budget_lines_budget ON budget_lines(budget_id);
CREATE INDEX idx_actual_expense_entries_event_code ON actual_expense_entries(event_id, expense_code_id);

-- The two specific people allowed to prepare/approve a Budget — a fixed
-- designation, not a role, per the user's explicit choice ("prepared by
-- specific person and approved by specific person or admin" — deliberately
-- NOT the general role-based approval_rules mechanism). Admin can always
-- act as a fallback approver regardless of who's designated here.
ALTER TABLE company_settings
  ADD COLUMN budget_preparer_user_id UUID REFERENCES users(id),
  ADD COLUMN budget_approver_user_id UUID REFERENCES users(id);

COMMIT;
