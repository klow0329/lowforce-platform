-- The "wide free-text box" billing row layout (currently hardcoded to
-- SPO/OTH) is now an admin-configurable flag per Price List item, same
-- pattern as is_upgrade_option/is_addon_item — so a company can mark its
-- own new item code (Sponsorship, Other, or anything else needing a big
-- description field) to use it, without a code change.
ALTER TABLE price_list ADD COLUMN is_wide_row BOOLEAN NOT NULL DEFAULT FALSE;

-- Preserve current behaviour for the existing seed items.
UPDATE price_list SET is_wide_row = TRUE WHERE sales_item_code IN ('SPO', 'OTH');
