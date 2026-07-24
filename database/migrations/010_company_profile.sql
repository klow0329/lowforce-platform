-- Company profile / letterhead fields for generated documents. The real
-- reference invoices (EXPOCO SDN BHD tax invoices) show registration/TIN/SST
-- numbers, address and bank details on the printed document — none of that
-- existed anywhere in the schema before this, it was all hardcoded/missing
-- on InvoicePrint. Left NULL here on purpose: this is real company data the
-- user fills in themselves via Admin > Settings, not something to seed with
-- a placeholder.
ALTER TABLE company_settings
  ADD COLUMN reg_no TEXT,
  ADD COLUMN tin_no TEXT,
  ADD COLUMN sst_no TEXT,
  ADD COLUMN address TEXT,
  ADD COLUMN phone TEXT,
  ADD COLUMN email TEXT,
  ADD COLUMN bank_name TEXT,
  ADD COLUMN bank_account_no TEXT,
  ADD COLUMN bank_swift TEXT,
  ADD COLUMN payment_instructions TEXT;
