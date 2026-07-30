-- Void Contract: a contract that has NOT yet had any invoice issued can be
-- voided instead of edited/deleted — this is the correct undo path for "we
-- made a mistake before invoicing", as opposed to a Credit Note, which only
-- ever applies against an already-confirmed invoice. Voiding auto-marks the
-- linked Opportunity as Lost and releases any booth held by either record
-- (see backend/src/controllers/approvals.controller.js's voidSalesOrder).
ALTER TABLE sales_orders
  ADD COLUMN voided_by   UUID REFERENCES users(id),
  ADD COLUMN voided_at   TIMESTAMPTZ,
  ADD COLUMN void_reason TEXT;

-- Credit Note reason categories — company-configurable (standing rule #2),
-- not a fixed code list, so each company can add/rename/deactivate its own.
-- Seeded with the examples the user asked for as default seed data.
CREATE TABLE cn_reason_codes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL REFERENCES companies(id),
    code        TEXT NOT NULL,
    label       TEXT NOT NULL,
    sort_order  INT NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (company_id, code)
);

INSERT INTO cn_reason_codes (company_id, code, label, sort_order)
SELECT c.id, d.code, d.label, d.sort_order
FROM companies c
CROSS JOIN (VALUES
  ('WRONG_ITEM', 'Wrong Item', 1),
  ('WRONG_EXHIBITOR', 'Wrong Exhibitor', 2),
  ('WITHDRAWAL', 'Exhibitor Withdrawal', 3),
  ('TAX_ADJUSTMENT', 'Tax Adjustment', 4),
  ('PRICE_ADJUSTMENT', 'Price Adjustment', 5),
  ('OTHER', 'Other', 6)
) AS d(code, label, sort_order);

-- Redesigned CN request shape: instead of a free-typed RM amount, the
-- requester adjusts the contract's actual line items in a billing-template
-- editor (see BillingTemplate.jsx's readOnly-bypass adjustment mode) and the
-- CN amount is computed as the shortfall between the original and adjusted
-- totals. original_items/adjusted_items are a snapshot (not a live link) so
-- the CN document and its print stay a faithful record even if the contract
-- itself is later touched again elsewhere. `reason` (free text) becomes
-- optional supplementary detail alongside the now-required reason_code_id.
ALTER TABLE credit_notes
  ADD COLUMN reason_code_id  UUID REFERENCES cn_reason_codes(id),
  ADD COLUMN original_items  JSONB,
  ADD COLUMN adjusted_items  JSONB,
  ALTER COLUMN reason DROP NOT NULL;
