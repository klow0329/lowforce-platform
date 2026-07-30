-- Snapshot of the contract's line items BEFORE the reduction was applied —
-- same before/after pairing credit_notes already keeps (original_items /
-- adjusted_items), needed so the auto-generated shortfall Credit Note (see
-- contractReductions.controller.js's issueContractReductionCn) has a real
-- "before" picture to show, and so the Contract Reduction's own detail view
-- can render a proper before/after diff later.
ALTER TABLE contract_reductions ADD COLUMN original_items JSONB NOT NULL DEFAULT '[]'::jsonb;
