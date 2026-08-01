-- Company's own formatted Contract Terms & Conditions as a PDF, uploaded
-- once and auto-appended as trailing pages onto every generated Contract/
-- Application Form PDF — replaces having to re-type it into contract_terms
-- (kept as a fallback for companies that haven't uploaded a PDF yet).
ALTER TABLE company_settings
  ADD COLUMN contract_terms_pdf_filename TEXT;
