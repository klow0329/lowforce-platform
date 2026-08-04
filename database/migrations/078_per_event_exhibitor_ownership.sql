-- Per-event exhibitor ownership. Until now `exhibitors.salesperson_id` was
-- a single GLOBAL owner, so the same exhibitor taking part in two events
-- could only ever belong to one rep — the case the user raised directly:
-- ABC Co under MIFB (Sew Wah's) should be claimable by a different rep
-- under AgriFood without either side losing their own assignment.
--
-- There is still exactly ONE exhibitor row (never duplicated per event) —
-- what becomes per-event is the ASSIGNMENT, which lives on the existing
-- exhibitor_events join row.
--
-- `exhibitors.salesperson_id` is deliberately left in place and still
-- maintained: it stays the account-level default used when creating a new
-- Opportunity/Contract before any event link exists, and every existing
-- query keeps working untouched. The per-event value takes priority where
-- it's set; NULL means "fall back to the account-level owner".
ALTER TABLE exhibitor_events ADD COLUMN IF NOT EXISTS salesperson_id UUID REFERENCES users(id);
ALTER TABLE exhibitor_events ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_exhibitor_events_salesperson ON exhibitor_events(salesperson_id);
CREATE INDEX IF NOT EXISTS idx_exhibitor_events_event ON exhibitor_events(event_id);

-- Backfill so nothing changes behaviour on day one: every existing
-- participation row inherits the exhibitor's current global owner.
UPDATE exhibitor_events ee
SET salesperson_id = ex.salesperson_id,
    assigned_at = now()
FROM exhibitors ex
WHERE ex.id = ee.exhibitor_id
  AND ee.salesperson_id IS NULL
  AND ex.salesperson_id IS NOT NULL;
