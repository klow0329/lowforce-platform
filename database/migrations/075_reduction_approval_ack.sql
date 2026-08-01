-- Sales was never notified when their own Value Change request (contract
-- reduction) got approved or rejected — the request deliberately leaves
-- sales_orders.status untouched while resolving, so it never showed up in
-- the existing "your contract was approved" Task To-Do query, which only
-- fires off so.status transitions (2026-08-01 user report: full
-- notification chain requested for the Value Change flow). Mirrors
-- sales_orders.approval_acknowledged_by/at exactly.
ALTER TABLE contract_reductions ADD COLUMN approval_acknowledged_by UUID REFERENCES users(id);
ALTER TABLE contract_reductions ADD COLUMN approval_acknowledged_at TIMESTAMPTZ;
