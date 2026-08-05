-- Removes the abandoned events.tier = 'CATEGORY' option. Migration 083
-- introduced it as "a sub-event within an Edition" (MCE26/MYFT26, a new
-- child EVENT row recreated every year), but migration 084 (same day)
-- explicitly reworked that whole idea into the year-independent
-- event_categories table ("Sub-event" in the UI) instead — 084's own
-- comment calls out that converting any existing CATEGORY-tier events was
-- left as a deliberate follow-up "separate, explicit, verified data step",
-- which never happened. The result: two different, confusingly-overlapping
-- "category" concepts sitting in the product at once (a dead tier option
-- still selectable in Admin > Events' Add Event form, and the real,
-- actually-wired-up Sub-event/event_categories mechanism) — exactly the
-- confusion the user flagged. events.tier = 'CATEGORY' was never consumed
-- anywhere outside one validation check (admin.controller.js), so nothing
-- else depends on it.
--
-- Deletes the one orphan row this produced ("MIFBS" under MIFB27, zero
-- references anywhere — sales_orders/opportunities/price_list/floor_plan_
-- halls/credit_terms/user_event_access all checked clean) and tightens the
-- CHECK constraint so the tier can't be selected again.
DELETE FROM events WHERE tier = 'CATEGORY';

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_tier_check;
ALTER TABLE events ADD CONSTRAINT events_tier_check CHECK (tier IN ('MAIN', 'EDITION'));
