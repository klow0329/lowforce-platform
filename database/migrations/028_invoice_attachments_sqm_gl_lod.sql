-- Invoice attachments — same shape/pattern as sales_order_attachments
-- (006_line_items_tax_approvals.sql), just against an invoice instead of a
-- contract, for Finance to attach supporting docs at confirm time.
CREATE TABLE invoice_attachments (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id         UUID NOT NULL REFERENCES invoices(id),
    original_filename  TEXT NOT NULL,
    stored_filename    TEXT NOT NULL,
    mime_type          TEXT,
    size_bytes         INT,
    uploaded_by        UUID REFERENCES users(id),
    uploaded_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Booth mass pickup: a friendlier, more prominent "Total Sqm" field next to
-- Hall/Booth No — the cap for how much sqm can be picked on the Floor Plan
-- for this deal (see FloorPlan.jsx's new 'cap' pick mode). Distinct from
-- the Bare Space line item's own qty (still the actual billing driver) —
-- this is set BEFORE billing exists yet, on a fresh Opportunity, and is
-- also just a plainer number to look at than hunting through the billing
-- grid for it.
ALTER TABLE opportunities ADD COLUMN total_sqm NUMERIC(10,2);
ALTER TABLE sales_orders ADD COLUMN total_sqm NUMERIC(10,2);

-- GL/expense code reference list now also covers revenue codes, not just
-- expense — same table, a type column to tell them apart in the Admin UI
-- and Budget dropdowns.
ALTER TABLE expense_codes ADD COLUMN type TEXT NOT NULL DEFAULT 'EXPENSE';

-- LOD (Loading charge) is priced as a % of Bare Space's rate — was
-- hardcoded 15% in BillingTemplate.jsx; now a company-configurable setting
-- (standing rule #2) so a second company (or a future rate change) doesn't
-- need code changes.
ALTER TABLE company_settings ADD COLUMN lod_pct_of_bas NUMERIC(5,2) NOT NULL DEFAULT 15.00;
