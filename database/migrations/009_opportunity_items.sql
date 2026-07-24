-- Opportunities get the same line-item billing template as Contracts (Bare
-- Space + one upgrade + Corner/Loading/MEP/Sponsorship/Badge/Other), so a
-- lead can be quoted in full detail before it's ever transferred to a
-- Contract. Mirrors sales_order_items; total_foreign mirrors
-- sales_orders.total_foreign (contract-currency total), and the existing
-- estimated_value_myr becomes server-computed once items exist, same as
-- how sales_orders.total_myr works.
CREATE TABLE opportunity_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES opportunities(id),
  price_list_id UUID REFERENCES price_list(id),
  sales_item_code TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'OTHER',
  qty NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_type TEXT,
  discount_value NUMERIC(12,2),
  tax_code_id UUID REFERENCES tax_codes(id),
  tax_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_opportunity_items_opportunity ON opportunity_items(opportunity_id);

ALTER TABLE opportunities
  ADD COLUMN total_foreign NUMERIC(12,2);

UPDATE opportunities SET total_foreign = estimated_value_myr WHERE total_foreign IS NULL;
