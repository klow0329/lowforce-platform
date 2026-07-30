-- Contract Reduction — a direct "reduce the contract's total value" request,
-- distinct from the existing item-based Credit Note flow (which is about
-- giving back physical booth sqm). This is a pure value adjustment: the
-- shortfall against whatever's already been CONFIRMED-invoiced auto-
-- generates the necessary Credit Note(s) (one per invoice the user picks to
-- allocate against), and any not-yet-issued milestone gets its amount
-- recalculated against the new total. One approval covers the whole
-- request — the reduction and any Credit Notes it produces — per the
-- user's explicit "no need to separate it" instruction (2026-07-30).
CREATE TABLE contract_reductions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  event_id          UUID NOT NULL REFERENCES events(id),
  sales_order_id    UUID NOT NULL REFERENCES sales_orders(id),
  exhibitor_id      UUID NOT NULL REFERENCES exhibitors(id),
  old_total_foreign NUMERIC(12,2) NOT NULL,
  new_total_foreign NUMERIC(12,2) NOT NULL,
  reason_code_id    UUID REFERENCES cn_reason_codes(id),
  notes             TEXT,
  -- [{invoice_id, amount_foreign, billing_pct}] — new amounts for whichever
  -- SCHEDULED (not-yet-issued) invoices absorb the leftover balance.
  milestone_plan    JSONB NOT NULL DEFAULT '[]',
  -- [{invoice_id, amount_myr}] — the user's own allocation of the shortfall
  -- (against already-issued invoices) when new_total < what's been invoiced.
  cn_allocations    JSONB NOT NULL DEFAULT '[]',
  status            TEXT NOT NULL DEFAULT 'PENDING_APPROVAL', -- PENDING_APPROVAL, APPROVED, REJECTED
  requested_by      UUID REFERENCES users(id),
  approved_by       UUID REFERENCES users(id),
  approved_at       TIMESTAMPTZ,
  rejection_notes   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_contract_reductions_sales_order ON contract_reductions(sales_order_id);
CREATE INDEX idx_contract_reductions_company_status ON contract_reductions(company_id, status);

ALTER TABLE credit_notes ADD COLUMN contract_reduction_id UUID REFERENCES contract_reductions(id);

ALTER TABLE approval_log ADD COLUMN contract_reduction_id UUID REFERENCES contract_reductions(id);
