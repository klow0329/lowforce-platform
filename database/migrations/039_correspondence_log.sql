-- A real append-only history of dated notes ("action + feedback") on an
-- Opportunity, and (replacing the old single-value aging_notes) on an
-- Invoice's AR Aging follow-up — every save ADDS an entry instead of
-- overwriting the last one, per the user's explicit ask. Polymorphic on
-- purpose: both screens want the identical "click to see history, add a
-- new note" behavior, so one table serves both rather than duplicating it.
CREATE TABLE correspondence_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('opportunity', 'invoice')),
  entity_id   UUID NOT NULL,
  note        TEXT NOT NULL,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_correspondence_entity ON correspondence_entries(entity_type, entity_id, created_at DESC);

-- Preserve whatever Finance already typed into AR Aging's old single-value
-- field as that invoice's first log entry, so nothing recorded is lost.
INSERT INTO correspondence_entries (company_id, entity_type, entity_id, note, created_at)
SELECT company_id, 'invoice', id, aging_notes, COALESCE(aging_updated_at, now())
FROM invoices WHERE aging_notes IS NOT NULL AND TRIM(aging_notes) != '';
