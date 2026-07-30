-- Payments/allocations were MYR-only. A payment against a USD contract now
-- carries its own doc currency + exchange rate, same shape as invoices
-- (amount_foreign/exchange_rate/currency, with amount_myr kept as the
-- authoritative figure every existing balance/aging/reporting query already
-- reads). A single payment is restricted to ONE currency going forward
-- (enforced in payments.controller.js) — allocations can only be split
-- across invoices that share the payment's own currency.
ALTER TABLE payments
  ADD COLUMN currency       TEXT NOT NULL DEFAULT 'MYR',
  ADD COLUMN exchange_rate  NUMERIC(10,4) NOT NULL DEFAULT 1,
  ADD COLUMN amount_foreign NUMERIC(12,2);
UPDATE payments SET amount_foreign = amount_myr WHERE amount_foreign IS NULL;
ALTER TABLE payments ALTER COLUMN amount_foreign SET NOT NULL;

ALTER TABLE payment_allocations
  ADD COLUMN amount_foreign NUMERIC(12,2);
UPDATE payment_allocations SET amount_foreign = amount_myr WHERE amount_foreign IS NULL;
ALTER TABLE payment_allocations ALTER COLUMN amount_foreign SET NOT NULL;
