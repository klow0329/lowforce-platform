-- Credit Terms: company/event-configurable installment payment schedules
-- (per user request, modeled on the legacy MIFB26 Excel "LIST" sheet's 3
-- standard schedules — e.g. 20% due 1 month after signing / 30% by a fixed
-- date / 50% due 3 months before Move-In — and the "CUSTOMER AGING" sheet's
-- per-milestone overdue tracking). Event-scoped like price_list, since the
-- resolved dates (fixed calendar dates, or "days/weeks/months after
-- signing") are specific to one event's calendar each cycle.
CREATE TABLE credit_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  event_id UUID NOT NULL REFERENCES events(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  -- When set, this becomes the default Credit Terms for a new Opportunity/
  -- Contract at this rate Tier (booking_type) — matching how price_list
  -- rows are already looked up by the same tier value. Null = not a
  -- default for any tier, still selectable manually.
  default_for_tier TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, event_id, code)
);

-- Each row is one installment: what % is due, and when. FIXED_DATE stores
-- the calendar date directly (e.g. "31 December 2025", or a resolved
-- "3 months before Move-In"); the *_AFTER_SIGNING variants are relative to
-- the contract's own contract_date, resolved at the point Sales generates
-- scheduled invoices for that specific contract.
CREATE TABLE credit_term_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_term_id UUID NOT NULL REFERENCES credit_terms(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  pct NUMERIC(5,2) NOT NULL,
  basis_type TEXT NOT NULL CHECK (basis_type IN ('FIXED_DATE', 'DAYS_AFTER_SIGNING', 'WEEKS_AFTER_SIGNING', 'MONTHS_AFTER_SIGNING')),
  basis_date DATE,
  basis_value INTEGER,
  description TEXT
);

ALTER TABLE opportunities ADD COLUMN credit_terms_id UUID REFERENCES credit_terms(id);
ALTER TABLE sales_orders ADD COLUMN credit_terms_id UUID REFERENCES credit_terms(id);

-- The real due date for AR aging purposes — distinct from expected_payment_
-- date (a Sales/Finance follow-up note) and expected_billing_date (a
-- pre-issuance SCHEDULED-invoice planning date). Set once at invoice
-- creation (from the credit term line's resolved date when generated via a
-- Credit Term, else the invoice's own issue date for due-on-receipt
-- invoices) and never recomputed afterward, so aging stays stable even if
-- the underlying credit term is edited later.
ALTER TABLE invoices ADD COLUMN due_date DATE;
UPDATE invoices SET due_date = invoice_date WHERE due_date IS NULL AND invoice_date IS NOT NULL;
