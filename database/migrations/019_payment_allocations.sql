-- Payments move from "1 payment = 1 invoice" to "1 payment (money actually
-- received from a customer) can be allocated across 1+ invoices, with any
-- unallocated remainder left as a usable credit for that customer." Solves
-- three real scenarios the old strict model couldn't: underpayment (already
-- worked — partial allocation, unchanged), overpayment (excess just sits
-- unallocated rather than being rejected outright), and an agent paying one
-- lump sum against many invoices without saying which up front (record the
-- money now, allocate — possibly later, possibly in pieces — afterward).

BEGIN;

-- payments becomes customer-level. company_id/exhibitor_id/event_id are
-- backfilled from the invoice each existing row was tied to, then made
-- NOT NULL once backfilled — invoice_id itself is retired in favour of
-- payment_allocations below.
ALTER TABLE payments
  ADD COLUMN company_id   UUID REFERENCES companies(id),
  ADD COLUMN exhibitor_id UUID REFERENCES exhibitors(id),
  ADD COLUMN event_id     UUID REFERENCES events(id);

UPDATE payments p SET
  company_id   = inv.company_id,
  exhibitor_id = inv.exhibitor_id,
  event_id     = inv.event_id
FROM invoices inv
WHERE inv.id = p.invoice_id;

CREATE TABLE payment_allocations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id  UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    invoice_id  UUID NOT NULL REFERENCES invoices(id),
    amount_myr  NUMERIC(12,2) NOT NULL
);

-- Every existing payment was already fully allocated to the one invoice it
-- was recorded against — preserve that as an explicit allocation row so no
-- historical balance/aging figure changes.
INSERT INTO payment_allocations (payment_id, invoice_id, amount_myr)
SELECT id, invoice_id, amount_myr FROM payments WHERE invoice_id IS NOT NULL;

ALTER TABLE payments DROP COLUMN invoice_id;
ALTER TABLE payments ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE payments ALTER COLUMN exhibitor_id SET NOT NULL;

CREATE INDEX idx_payment_allocations_payment ON payment_allocations(payment_id);
CREATE INDEX idx_payment_allocations_invoice ON payment_allocations(invoice_id);
CREATE INDEX idx_payments_exhibitor ON payments(exhibitor_id);
CREATE INDEX idx_payments_event ON payments(event_id);

COMMIT;
