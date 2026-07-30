-- Same "unread until acknowledged" pattern as payment_allocations
-- (see 023_payment_ack_credit_notes.sql) — Sales gets a Task To-Do item the
-- moment Finance confirms an invoice on their contract, and it stays
-- visible until they explicitly acknowledge it.
ALTER TABLE invoices
  ADD COLUMN confirm_acknowledged_by UUID REFERENCES users(id),
  ADD COLUMN confirm_acknowledged_at TIMESTAMPTZ;
