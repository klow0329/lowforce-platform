-- Company-configurable Terms & Conditions text, appended to the printed
-- Contract — was previously hardcoded per the original ExpoCO tailoring;
-- this makes it a per-company admin field so a future company brings its
-- own wording/layout instead of code changes.
ALTER TABLE company_settings ADD COLUMN contract_terms TEXT;
