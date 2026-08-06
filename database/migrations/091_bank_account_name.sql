-- The Contract's "Account Name" field on Section 4 (Payment) was reading
-- company.name (the company's registered legal name) -- correct for most
-- companies, but not actually admin-configurable, so it looked "already
-- imprinted" / hardcoded to a user who hadn't touched Banking yet, even
-- though it's real data. Bank accounts also aren't always held under the
-- exact registered name (a trading name, a parent-group account, etc.).
-- Adds a distinct, admin-editable field, NULL by default -- prints blank
-- like the other banking fields until an admin actually sets it, same
-- convention as Bank Name/Account No/SWIFT.
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS bank_account_name TEXT;
