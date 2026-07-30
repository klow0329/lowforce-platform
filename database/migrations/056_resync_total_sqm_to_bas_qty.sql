-- A handful of contracts (5 as of this writing) had total_sqm drift out of
-- sync with their own BAS line item's qty — the standing rule is that
-- total_sqm always mirrors Bare Space's own qty, so wherever a BAS item
-- exists, treat it as the authoritative source and resync.
UPDATE sales_orders so
SET total_sqm = bas.qty
FROM (
  SELECT sales_order_id, SUM(qty) AS qty FROM sales_order_items
  WHERE sales_item_code = 'BAS'
  GROUP BY sales_order_id
) bas
WHERE bas.sales_order_id = so.id
  AND COALESCE(so.total_sqm, 0) <> bas.qty;
