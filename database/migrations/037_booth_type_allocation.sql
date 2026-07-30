-- Lets the Floor Plan picker tag which specific booth is Bare Space vs which
-- upgrade tier (e.g. 54 sqm Bare Space + 18 sqm Shell Scheme picked as one
-- multi-booth selection) — stored per CLAIM (not per booth), since a
-- still-Proposed booth can carry more than one competing claim at once (see
-- floor_plan_booth_claims, migration 033) and each claimant may be pricing
-- it under a different type until one contract actually wins it. NULL means
-- untagged/not yet allocated — treated as Bare Space for any booth claimed
-- before this column existed.
ALTER TABLE floor_plan_booth_claims ADD COLUMN allocated_item_code TEXT;
