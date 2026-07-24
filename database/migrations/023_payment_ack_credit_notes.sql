-- Payment acknowledgement: the salesperson's Task To-Do "payment received"
-- item used to just age out after 7 days whether or not anyone actually
-- saw it. Adding a real ack flag turns it into an inbox-style unread item
-- instead — it now stays visible (no time cap) until the salesperson
-- explicitly acknowledges it, and disappears the moment they do.
ALTER TABLE payment_allocations
  ADD COLUMN acknowledged_by UUID REFERENCES users(id),
  ADD COLUMN acknowledged_at TIMESTAMPTZ;

-- Credit Notes: a value-reduction request against an already-approved
-- contract, kept deliberately separate from sales_orders.total_myr so
-- revenue/contracted-value reporting is never retroactively disturbed by
-- one — the contract's own value stays exactly as originally approved;
-- the CN is a distinct, its-own-line AR adjustment. Mirrors the
-- Invoice DRAFT -> CONFIRMED shape once past its own approval step:
--   PENDING_APPROVAL  — just requested by Sales, awaiting the approver
--                        the tiered CREDIT_NOTE_ISSUED matrix names
--                        (falls back to Admin/Management, same pattern
--                        as REVENUE_ABOVE_THRESHOLD).
--   REJECTED          — approver declined; Sales may resubmit.
--   DRAFT              — approved; a real draft CN document now exists,
--                        allocated against one specific invoice.
--   CONFIRMED          — Finance has confirmed it; only from this point
--                        does it actually reduce that invoice's balance.
CREATE TABLE credit_notes (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id       UUID NOT NULL REFERENCES companies(id),
    event_id         UUID NOT NULL REFERENCES events(id),
    sales_order_id   UUID NOT NULL REFERENCES sales_orders(id),
    exhibitor_id     UUID NOT NULL REFERENCES exhibitors(id),
    invoice_id       UUID NOT NULL REFERENCES invoices(id),
    cn_no            TEXT,                          -- assigned on approval, not at request time
    cn_date          DATE,
    amount_myr       NUMERIC(12,2) NOT NULL,
    reason           TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    requested_by     UUID REFERENCES users(id),
    approved_by      UUID REFERENCES users(id),
    approved_at      TIMESTAMPTZ,
    confirmed_by     UUID REFERENCES users(id),
    confirmed_at     TIMESTAMPTZ,
    rejection_notes  TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, cn_no)
);
CREATE INDEX idx_credit_notes_invoice ON credit_notes(invoice_id);
CREATE INDEX idx_credit_notes_sales_order ON credit_notes(sales_order_id);
CREATE INDEX idx_credit_notes_company_status ON credit_notes(company_id, status);
