-- Hall/Booth No/Dimension should carry from Opportunity through to Contract
-- (user can still edit after each transfer), matching the sales_orders columns.
ALTER TABLE opportunities
  ADD COLUMN hall TEXT,
  ADD COLUMN booth_no TEXT,
  ADD COLUMN dimension TEXT;
