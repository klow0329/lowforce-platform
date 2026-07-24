-- Fascia board display name per booth — what's printed on the physical
-- booth's fascia when the exhibitor wants something other than their full
-- registered company name. Blank = falls back to the exhibitor name.
-- Cleared automatically whenever the booth's assignment is released.

ALTER TABLE floor_plan_booths ADD COLUMN fascia_name TEXT;
