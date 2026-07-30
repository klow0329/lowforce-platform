-- Admin reversible archive/delete: data created by user or system error can
-- clutter the system and confuse other users, but real accounting/audit
-- records should never be truly destroyed — an Admin can archive any of
-- these six record types (hides it everywhere immediately) and restore it
-- later if it turns out to be needed. exhibitors/opportunities/sales_orders
-- already had an is_active column (already the read-filter used by their
-- list queries, just never had a UI to actually set it false) — reused here
-- rather than adding a second flag. invoices/credit_notes/payments never had
-- a soft-delete concept before, so they get a fresh is_active column too.
ALTER TABLE exhibitors ADD COLUMN deleted_by UUID REFERENCES users(id);
ALTER TABLE exhibitors ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE exhibitors ADD COLUMN delete_reason TEXT;

ALTER TABLE opportunities ADD COLUMN deleted_by UUID REFERENCES users(id);
ALTER TABLE opportunities ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE opportunities ADD COLUMN delete_reason TEXT;

ALTER TABLE sales_orders ADD COLUMN deleted_by UUID REFERENCES users(id);
ALTER TABLE sales_orders ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE sales_orders ADD COLUMN delete_reason TEXT;

ALTER TABLE invoices ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE invoices ADD COLUMN deleted_by UUID REFERENCES users(id);
ALTER TABLE invoices ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN delete_reason TEXT;

ALTER TABLE credit_notes ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE credit_notes ADD COLUMN deleted_by UUID REFERENCES users(id);
ALTER TABLE credit_notes ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE credit_notes ADD COLUMN delete_reason TEXT;

ALTER TABLE payments ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE payments ADD COLUMN deleted_by UUID REFERENCES users(id);
ALTER TABLE payments ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN delete_reason TEXT;
