-- Generic per-booth tagging for any admin-added "booth-related" Price List
-- item (price_list.is_booth_related, migration 069) beyond Corner Charge
-- and Loading, which already have their own dedicated, deeply-wired
-- floor_plan_booths.is_corner/is_loading columns (booth editor, bulk edit,
-- undo history, grid generator) — left untouched since they already work
-- correctly; rewriting them onto this table would add risk with no benefit.
-- This table is deliberately scoped to any OTHER item code a company flags
-- is_booth_related later, so a new one never needs a schema/code change —
-- same principle as price_list's own is_upgrade_option generalization
-- (migration 029).
CREATE TABLE IF NOT EXISTS floor_plan_booth_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  booth_id UUID NOT NULL REFERENCES floor_plan_booths(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (booth_id, item_code)
);
CREATE INDEX IF NOT EXISTS idx_floor_plan_booth_addons_booth_id ON floor_plan_booth_addons(booth_id);
