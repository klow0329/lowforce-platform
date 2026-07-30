-- Tracks whether a record has picked a REPLACEMENT booth since losing one
-- to a competing approval (release_reason = 'LOST_TO_APPROVAL') — separate
-- from acknowledged_at (just "seen it") so a persistent "please allocate
-- ASAP" banner can keep showing on the Opportunity/Contract itself until
-- the user actually goes back to the Floor Plan and commits a new pick,
-- not merely dismisses the Task To-Do notification.
ALTER TABLE floor_plan_booth_claims ADD COLUMN reallocated_at TIMESTAMPTZ;
