-- Customer Aging follow-up tracking: Finance/Sales need to record when they
-- expect a customer to pay and the latest correspondence, with a timestamp
-- so anyone can see when that was last updated (not who — same audit level
-- as the rest of the app's free-text notes fields today).
ALTER TABLE invoices
  ADD COLUMN expected_payment_date DATE,
  ADD COLUMN aging_notes TEXT,
  ADD COLUMN aging_updated_at TIMESTAMPTZ;
