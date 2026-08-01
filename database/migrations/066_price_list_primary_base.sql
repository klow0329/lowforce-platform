-- Makes the "primary base" booth item (e.g. Bare Space) admin-configurable
-- per event instead of hardcoded to the literal sales_item_code 'BAS' —
-- a different company may not use that name/code at all. Exactly one
-- sales_item_code per event should carry is_primary_base = true across all
-- of its rate-tier rows; the application layer (priceList.controller.js)
-- enforces that invariant on write.
ALTER TABLE price_list ADD COLUMN IF NOT EXISTS is_primary_base BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: every existing event's current 'BAS' rows become its flagged
-- primary base, so nothing changes in behavior until an admin deliberately
-- reconfigures it.
UPDATE price_list SET is_primary_base = TRUE WHERE sales_item_code = 'BAS';
