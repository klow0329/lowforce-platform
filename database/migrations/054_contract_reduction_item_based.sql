-- Contract Reduction moves from "type a target total" to the same
-- item-based billing-template editing the old Credit Note flow used —
-- sales edits the actual line items (and releases any excess booths) to
-- reflect the newly agreed deal; the system derives new_total_foreign and
-- any resulting shortfall itself. released_booth_ids mirrors credit_notes'
-- own column (nothing happens to them until APPROVED). cn_amount_* is the
-- shortfall against already-CONFIRMED invoices, computed at request time —
-- approved together with the reduction itself, but the actual Credit Note
-- document (and which invoice it targets) is only created afterward, when
-- Sales explicitly issues it (see contractReductions.controller.js's new
-- issueContractReductionCn) — not pre-picked at request time.
ALTER TABLE contract_reductions
  ADD COLUMN reduced_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN released_booth_ids UUID[],
  ADD COLUMN cn_amount_foreign NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN cn_amount_myr NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN cn_issued_at TIMESTAMPTZ;
