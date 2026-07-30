-- Round 6 item 4: an unsold ("Proposed") booth can be claimed by more than
-- one Opportunity/draft Contract at once — whichever one gets its Contract
-- APPROVED first wins the booth for real; every other active claim on it
-- is then auto-released, with the losing Sales user notified to re-pick.
--
-- floor_plan_booths.opportunity_id/sales_order_id stay exactly as they are
-- today (a single FK each) — they now mean "the currently displayed/primary
-- claimant" (drives computed_status, the Contracts-list booth tracker,
-- print pages — nothing there needs to change). This table is the real
-- multi-claim source of truth: listRecordBooths/bulkSetRecordBooths read
-- from it, and the backend re-derives the primary column from whichever
-- active claim is oldest any time a claim is added or released.
CREATE TABLE floor_plan_booth_claims (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id),
    booth_id        UUID NOT NULL REFERENCES floor_plan_booths(id) ON DELETE CASCADE,
    record_type     TEXT NOT NULL CHECK (record_type IN ('opportunity', 'sales_order')),
    record_id       UUID NOT NULL,
    claimed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    released_at     TIMESTAMPTZ,
    release_reason  TEXT,
    acknowledged_by UUID REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ
);

-- A record can only hold ONE active claim on a given booth at a time.
CREATE UNIQUE INDEX floor_plan_booth_claims_active_uniq
  ON floor_plan_booth_claims (booth_id, record_type, record_id) WHERE released_at IS NULL;
CREATE INDEX idx_fpbc_booth_active ON floor_plan_booth_claims (booth_id) WHERE released_at IS NULL;
CREATE INDEX idx_fpbc_record_active ON floor_plan_booth_claims (record_type, record_id) WHERE released_at IS NULL;
CREATE INDEX idx_fpbc_lost_unack ON floor_plan_booth_claims (record_type, record_id) WHERE release_reason = 'LOST_TO_APPROVAL' AND acknowledged_at IS NULL;

-- Backfill: every booth already linked via the old single-slot columns gets
-- a matching active claim, so existing real contracts/opportunities don't
-- suddenly show zero booths once listRecordBooths starts reading from this
-- table instead of the raw columns.
INSERT INTO floor_plan_booth_claims (company_id, booth_id, record_type, record_id, claimed_at)
SELECT h.company_id, b.id, 'opportunity', b.opportunity_id, b.created_at
FROM floor_plan_booths b JOIN floor_plan_halls h ON h.id = b.hall_id
WHERE b.opportunity_id IS NOT NULL;

INSERT INTO floor_plan_booth_claims (company_id, booth_id, record_type, record_id, claimed_at)
SELECT h.company_id, b.id, 'sales_order', b.sales_order_id, b.created_at
FROM floor_plan_booths b JOIN floor_plan_halls h ON h.id = b.hall_id
WHERE b.sales_order_id IS NOT NULL;
