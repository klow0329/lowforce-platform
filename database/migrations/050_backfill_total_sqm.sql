-- One-time data recovery (2026-07-30): total_sqm was split across two
-- competing columns (opportunities.total_sqm, the current authoritative
-- field since the booth-selection-first redesign, vs the legacy
-- opportunities.booth_sqm from before it) — application code has now been
-- fixed to read total_sqm consistently everywhere (Reports, Dashboard,
-- printed Contract/Invoice/Proforma "Booth Area" line), but ~499 of 508
-- approved contracts had never had sales_orders.total_sqm populated at all
-- (a bulk-imported/legacy-era contract, or one never re-saved since the
-- redesign). Recover it from the linked Opportunity's own sqm record —
-- total_sqm first (the current field), booth_sqm as fallback (the older
-- field, for contracts whose Opportunity itself was never updated since
-- the redesign either). Leaves anything with no recoverable source alone.
UPDATE sales_orders so
SET total_sqm = COALESCE(o.total_sqm, o.booth_sqm)
FROM opportunities o
WHERE so.opportunity_id = o.id
  AND so.total_sqm IS NULL
  AND COALESCE(o.total_sqm, o.booth_sqm) IS NOT NULL;

-- Same two-column split existed on opportunities itself — backfill any
-- opportunity still missing total_sqm from its own legacy booth_sqm value,
-- so the Opportunity list/Pipeline reports are consistent too.
UPDATE opportunities
SET total_sqm = booth_sqm
WHERE total_sqm IS NULL AND booth_sqm IS NOT NULL;
