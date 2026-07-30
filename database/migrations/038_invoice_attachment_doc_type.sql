-- Lets Sales/Finance tag what each invoice attachment actually is, and lets
-- Finance get a Task To-Do nudge specifically when a customer's proof of
-- payment is attached (separate from the general "invoice needs
-- confirming" flow — a payment proof can land on an already-confirmed
-- invoice too, whenever the customer pays late).
ALTER TABLE invoice_attachments ADD COLUMN doc_type TEXT NOT NULL DEFAULT 'SUPPORTING_DOC'
  CHECK (doc_type IN ('E_INVOICE', 'PAYMENT_PROOF', 'SUPPORTING_DOC'));
ALTER TABLE invoice_attachments ADD COLUMN finance_acknowledged_at TIMESTAMPTZ;
ALTER TABLE invoice_attachments ADD COLUMN finance_acknowledged_by UUID REFERENCES users(id);
