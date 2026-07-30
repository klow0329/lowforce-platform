-- Generalizes two things that were previously hardcoded in
-- BillingTemplate.jsx (UPGRADE_CODES, NARROW_ROW_CODES) into admin-editable
-- Price List columns, per standing rule #2 ("everything company-
-- configurable, nothing hardcoded") — a new company (or a new item on an
-- existing one) should never need a code change to:
--   a) offer a new Upgrade option (was: hardcoded SSS/ESS/WOP/CUB), or
--   b) add a new "addon" billing line priced at a flat rate OR as a % of
--      Bare Space (was: hardcoded COR/LOD/MEP/BAD, with LOD's %-of-BAS
--      formula itself hardcoded to that one item code).
--
-- LOD's own existing behavior (company_settings.lod_pct_of_bas) is left
-- completely untouched — this adds a second, independent mechanism for any
-- OTHER item an admin wants priced the same way, it doesn't replace LOD's.
ALTER TABLE price_list ADD COLUMN is_upgrade_option BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE price_list ADD COLUMN is_addon_item BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE price_list ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'FIXED'
  CHECK (pricing_mode IN ('FIXED', 'PCT_OF_BAS'));
ALTER TABLE price_list ADD COLUMN pricing_pct NUMERIC(5,2);

-- Backfill so today's seeded MIFB items keep behaving exactly as before —
-- these 4 booth-tier upgrades and 4 addon lines already function this way
-- in code; this just makes that fact admin-visible/editable going forward.
UPDATE price_list SET is_upgrade_option = TRUE WHERE sales_item_code IN ('SSS', 'ESS', 'WOP', 'CUB');
UPDATE price_list SET is_addon_item = TRUE WHERE sales_item_code IN ('COR', 'LOD', 'MEP', 'BAD');
