-- System-generated draft invoices: a contract can be split into milestone
-- invoices by percentage; Finance reviews/edits the draft (date, invoice no,
-- actual exchange rate) then commits it. billing_pct records what share of
-- the contract this installment represents, for display on the draft.

ALTER TABLE invoices
  ADD COLUMN status TEXT NOT NULL DEFAULT 'CONFIRMED', -- DRAFT | CONFIRMED
  ADD COLUMN billing_pct NUMERIC(5,2);

-- Every invoice that already exists (497 historical + anything created
-- earlier this session) was entered as final, so it stays CONFIRMED.
