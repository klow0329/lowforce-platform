-- A small number of contracts (2 as of this writing) predate the
-- booth-selection-first flow AND were never linked on the Floor Plan, so
-- migration 050's opportunity-based recovery couldn't reach them either —
-- their linked opportunity also never had total_sqm/booth_sqm populated.
-- Recover total_sqm from the contract's own BAS line item qty, which is
-- the one place the real sqm figure survived (e.g. 711 STREET KITCHEN,
-- 18 sqm Bare Space, Hall 2 booth 2409, entered before Floor Plan existed).
UPDATE sales_orders so
SET total_sqm = (
  SELECT SUM(soi.qty) FROM sales_order_items soi
  WHERE soi.sales_order_id = so.id AND soi.sales_item_code = 'BAS'
)
WHERE so.total_sqm IS NULL
  AND EXISTS (
    SELECT 1 FROM sales_order_items soi
    WHERE soi.sales_order_id = so.id AND soi.sales_item_code = 'BAS' AND soi.qty > 0
  );
