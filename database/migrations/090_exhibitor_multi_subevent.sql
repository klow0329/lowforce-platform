-- exhibitor_events.category_id could only ever hold ONE Sub-event tag per
-- (exhibitor, Edition) participation — but a real import showed an
-- exhibitor legitimately tagged with THREE Sub-events under the same Main
-- event at once (e.g. "MCE, MIFB, MYFT" all under one MIFB27 participation).
-- The single-column FK silently kept only the first; this replaces it with
-- a proper many-to-many join table.
CREATE TABLE IF NOT EXISTS exhibitor_event_categories (
    exhibitor_id  UUID NOT NULL,
    event_id      UUID NOT NULL,
    category_id   UUID NOT NULL REFERENCES event_categories(id),
    PRIMARY KEY (exhibitor_id, event_id, category_id),
    FOREIGN KEY (exhibitor_id, event_id) REFERENCES exhibitor_events(exhibitor_id, event_id) ON DELETE CASCADE
);

-- Backfill whatever single tag each participation already had.
INSERT INTO exhibitor_event_categories (exhibitor_id, event_id, category_id)
SELECT exhibitor_id, event_id, category_id FROM exhibitor_events WHERE category_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE exhibitor_events DROP COLUMN IF EXISTS category_id;
