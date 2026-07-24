-- When a hall's background was uploaded as a PDF (not a plain image), the
-- original PDF is kept alongside the rendered PNG so "Auto-detect Booths"
-- can re-read its text layer later — the PNG alone has no positioned text
-- to extract from.
ALTER TABLE floor_plan_halls
  ADD COLUMN source_pdf_filename TEXT;
