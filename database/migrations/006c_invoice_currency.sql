-- Refinement: the contract's exchange_rate is a default/estimate used only
-- for valuing NOT-YET-INVOICED balances. Each individual invoice carries
-- its own actual finance-entered rate, since a USD contract can be split
-- into several invoices, each settled at whatever the real rate was that
-- day (mirrors the old Excel's per-invoice RATE input by Finance).

ALTER TABLE sales_orders
  ADD COLUMN total_foreign NUMERIC(12,2); -- contract total in its own currency, pre-conversion

ALTER TABLE invoices
  ADD COLUMN currency        TEXT NOT NULL DEFAULT 'MYR',
  ADD COLUMN amount_foreign  NUMERIC(12,2), -- the invoiced amount in the contract's currency
  ADD COLUMN exchange_rate   NUMERIC(10,4) NOT NULL DEFAULT 1; -- actual rate Finance used for THIS invoice

-- Backfill: every existing invoice is historically MYR-denominated.
UPDATE invoices SET amount_foreign = amount_myr, currency = 'MYR', exchange_rate = 1 WHERE amount_foreign IS NULL;
UPDATE sales_orders SET total_foreign = total_myr WHERE total_foreign IS NULL;
