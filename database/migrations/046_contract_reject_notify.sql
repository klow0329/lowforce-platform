-- Reject notification was silently broken: the Task To-Do query could only
-- tell "back in Draft because rejected" apart from "still Draft, never
-- submitted yet" by approval_acknowledged_at IS NULL, but that column is
-- NULL for both cases (a fresh contract has never been acknowledged either).
-- rejected_at makes the reject case explicit and unambiguous.
ALTER TABLE sales_orders ADD COLUMN rejected_at TIMESTAMPTZ;
