-- Marks which Price List items are physically tied to a booth (like Corner
-- Charge/Loading) rather than a manual optional add-on Sales chooses per
-- deal (like MEP/Badge) — orthogonal to is_addon_item, which only controls
-- the narrow-row layout. A booth-related item's Qty in Billing is locked and
-- derived entirely from the Floor Plan's per-booth tagging (see
-- floor_plan_booth_addons, migration 070) instead of being manually typed,
-- same principle already applied to Bare Space and Upgrade rows
-- (2026-07-31 user request, after two live corruptions where a manual Qty
-- edit silently desynced billing from the Floor Plan).
ALTER TABLE price_list ADD COLUMN IF NOT EXISTS is_booth_related BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: Corner Charge and Loading already function this way in code
-- today (is_corner/is_loading flags on floor_plan_booths) — this just makes
-- that fact admin-visible/editable, and extends it to any new item a
-- company adds later, with no code change needed.
UPDATE price_list SET is_booth_related = TRUE WHERE sales_item_code IN ('COR', 'LOD');
