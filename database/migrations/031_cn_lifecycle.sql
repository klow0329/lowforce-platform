-- Credit Note lifecycle extension: a CN now actually mutates the contract
-- (total_sqm, line items) once APPROVED — not just an AR-balance record
-- against one invoice — with a distinct Floor Plan visual state while the
-- request is still pending, a withdraw/edit/delete path, and the same
-- attachment + Finance-confirm process Invoices already have.

-- Which specific floor_plan_booths this CN proposes to release, captured
-- at request time via the Floor Plan's 'cn' pick mode (see FloorPlan.jsx).
-- Nothing actually happens to these booths until the CN is approved — a
-- rejected/withdrawn request never touched the real allocation.
ALTER TABLE credit_notes ADD COLUMN released_booth_ids UUID[] NOT NULL DEFAULT '{}';

-- Mirrors invoices.confirm_acknowledged_by/at — lets Sales get a "CN
-- confirmed by Finance" Task To-Do item that clears once seen, same
-- pattern as the existing invoice-confirmed notification.
ALTER TABLE credit_notes ADD COLUMN confirm_acknowledged_by UUID REFERENCES users(id);
ALTER TABLE credit_notes ADD COLUMN confirm_acknowledged_at TIMESTAMPTZ;

-- Exact mirror of invoice_attachments (migration 028) — a CN now goes
-- through the same "issue -> attach supporting doc -> Finance confirms"
-- process as an Invoice.
CREATE TABLE credit_note_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id UUID NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  uploaded_by UUID REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_credit_note_attachments_cn ON credit_note_attachments(credit_note_id);

-- CN approve/reject/confirm/withdraw now write into the SAME approval_log
-- the contract's own approval actions already use, so they show up under
-- the existing Approval History widget (per user request) instead of only
-- living in the Credit Notes table's own status column. Nullable — every
-- non-CN row keeps credit_note_id NULL.
ALTER TABLE approval_log ADD COLUMN credit_note_id UUID REFERENCES credit_notes(id);

