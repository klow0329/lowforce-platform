-- Milestone billing gets a real "planned but not yet issued" state instead
-- of forcing every milestone to be created as a draft invoice up front.
-- SCHEDULED invoices carry an estimate (amount_foreign/amount_myr computed
-- at the rate in effect when the milestone plan was set up) and a target
-- date, but no invoice_no/invoice_date — those are assigned only once
-- someone actually clicks "Issue" on that line (see invoices.controller.js's
-- issueScheduledInvoice), the same "never consume a number early" pattern
-- already used for CN numbers. Excluded from every total_invoiced/balance
-- calc until it's a real DRAFT/CONFIRMED invoice.
ALTER TABLE invoices
  ALTER COLUMN invoice_no DROP NOT NULL,
  ALTER COLUMN invoice_date DROP NOT NULL,
  ADD COLUMN expected_billing_date DATE;
