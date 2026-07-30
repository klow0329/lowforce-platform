-- Sales was never notified when their contract got approved or rejected —
-- mirrors invoices.confirm_acknowledged_by/at (and credit_notes' own copy
-- of the same pattern): NULL means "not yet seen", set once the owning
-- salesperson acknowledges it from their Task To-Do.
ALTER TABLE sales_orders ADD COLUMN approval_acknowledged_by UUID REFERENCES users(id);
ALTER TABLE sales_orders ADD COLUMN approval_acknowledged_at TIMESTAMPTZ;
