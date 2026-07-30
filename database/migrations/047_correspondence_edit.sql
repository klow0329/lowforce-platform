-- Correspondence entries were append-only by design, but typos happen —
-- Sales/Finance need to fix an entry after the fact rather than leaving a
-- wrong note in the history forever. Track who/when edited so the log stays
-- accountable rather than silently mutable.
ALTER TABLE correspondence_entries ADD COLUMN edited_by UUID REFERENCES users(id);
ALTER TABLE correspondence_entries ADD COLUMN edited_at TIMESTAMPTZ;
