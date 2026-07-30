-- Lets bulk import (Admin > Segments > Upload Template) upsert cleanly by
-- (company, main segment, code) instead of always inserting duplicates.
ALTER TABLE segment_sub ADD CONSTRAINT segment_sub_company_main_code_key
  UNIQUE (company_id, segment_main_id, code);
