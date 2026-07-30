-- Lets Sales/Finance choose which name prints as the recipient on a
-- Proposal/Proforma/Contract/Invoice — Exhibitor Name, Billing Company
-- Name, or Agent Name — instead of always deriving it from the exhibitor's
-- billing_same_as_company flag. Defaults to BILLING (billing_name if set,
-- else falls back to the exhibitor's own company_name — unchanged rule).

ALTER TABLE opportunities ADD COLUMN bill_to_type TEXT NOT NULL DEFAULT 'BILLING'
  CHECK (bill_to_type IN ('EXHIBITOR', 'BILLING', 'AGENT'));

ALTER TABLE sales_orders ADD COLUMN bill_to_type TEXT NOT NULL DEFAULT 'BILLING'
  CHECK (bill_to_type IN ('EXHIBITOR', 'BILLING', 'AGENT'));

ALTER TABLE invoices ADD COLUMN bill_to_type TEXT NOT NULL DEFAULT 'BILLING'
  CHECK (bill_to_type IN ('EXHIBITOR', 'BILLING', 'AGENT'));
