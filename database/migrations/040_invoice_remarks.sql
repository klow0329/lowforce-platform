-- Remarks is now one shared value per deal — Opportunity, its Contract, and
-- every Invoice generated from that Contract all read/write the same note,
-- cascaded on every edit (see opportunities/salesOrders/invoices
-- controllers). Invoices never had their own remarks column before.
ALTER TABLE invoices ADD COLUMN remarks TEXT;
