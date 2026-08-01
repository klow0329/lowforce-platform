-- Adds "N days/weeks/months BEFORE the event's start date" as a Credit Term
-- installment basis, alongside the existing FIXED_DATE and *_AFTER_SIGNING
-- options (2026-08-01 user request) — resolved against events.start_date at
-- the point Sales generates scheduled invoices, same as *_AFTER_SIGNING is
-- resolved against the contract's own contract_date (see
-- creditTerms.controller.js's resolveLineDueDate).
ALTER TABLE credit_term_lines DROP CONSTRAINT credit_term_lines_basis_type_check;
ALTER TABLE credit_term_lines ADD CONSTRAINT credit_term_lines_basis_type_check
  CHECK (basis_type IN (
    'FIXED_DATE', 'DAYS_AFTER_SIGNING', 'WEEKS_AFTER_SIGNING', 'MONTHS_AFTER_SIGNING',
    'DAYS_BEFORE_EVENT', 'WEEKS_BEFORE_EVENT', 'MONTHS_BEFORE_EVENT'
  ));
