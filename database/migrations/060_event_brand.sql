-- Company Profile: a second, event-specific brand identity (logo + name)
-- alongside the company's own corporate logo/letterhead — most exhibition
-- companies run their event under its own brand (e.g. "MIFB") distinct from
-- the operating company's name (e.g. ExpoCO Sdn Bhd), and want that brand on
-- customer-facing forms. Reuses the same branding-image storage pattern as
-- logo/letterhead/footer (see migration 022).
ALTER TABLE company_settings
  ADD COLUMN event_name TEXT,
  ADD COLUMN event_logo_filename TEXT;
