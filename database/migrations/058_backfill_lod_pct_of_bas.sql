-- The Company Profile "LOD fallback %" field (company_settings.lod_pct_of_bas)
-- is being retired from the Admin UI — it duplicates what the Price List's
-- own generic "% of Bare Space" pricing mode already does per-event (see
-- migration 029), and the user considers keeping both a confusing double
-- control surface. MIFB27's LOD row was already migrated to PCT_OF_BAS; this
-- backfills MIFB26's LOD row (still FIXED, with no pricing_pct) to the same
-- PCT_OF_BAS mode at its current effective rate, so retiring the Admin field
-- doesn't silently change any real contract's LOD price.
UPDATE price_list pl
SET pricing_mode = 'PCT_OF_BAS',
    pricing_pct = cs.lod_pct_of_bas
FROM company_settings cs
WHERE pl.company_id = cs.company_id
  AND pl.sales_item_code = 'LOD'
  AND pl.pricing_mode = 'FIXED';
