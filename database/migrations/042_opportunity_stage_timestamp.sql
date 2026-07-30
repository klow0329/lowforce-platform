-- Tracks when the opportunity's stage last changed, shown next to Stage on
-- the detail page — "Proposal Sent" is now also system-driven (see
-- OpportunityDetail.jsx's View Proposal handler), same as Contract Sent/Won
-- already were, so this timestamp records every one of those transitions.
ALTER TABLE opportunities ADD COLUMN stage_changed_at TIMESTAMPTZ;
UPDATE opportunities SET stage_changed_at = created_at WHERE stage_changed_at IS NULL;
