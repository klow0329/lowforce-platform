-- Lets an exhibitor's Billing section point at another existing exhibitor
-- record as the bill-to party (e.g. a parent company or booking agency that
-- is itself already an exhibitor) instead of retyping its details as free
-- text, and without a separate "Billing Company" master table — reuses the
-- exhibitors table itself as the source, per the user's explicit request.
-- billing_name/address/etc. stay as the materialized snapshot copied from
-- the linked exhibitor at save time (same pattern "Same as Exhibitor Info"
-- already uses) so every existing reader of those columns (invoices, print
-- pages, statements) needs no changes.
ALTER TABLE exhibitors
  ADD COLUMN billing_exhibitor_id UUID REFERENCES exhibitors(id);
