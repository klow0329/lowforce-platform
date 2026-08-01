-- Found while cross-checking Dashboard's "Total Booths (Won)" tile against
-- Reports > Overview and By Item & Type for MIFB26/MIFB27.
--
-- FINFIN's (contract 28f6e0c6) BAS line item was tagged category='OTHER'
-- instead of 'BOOTH' — a single corrupted row (verified: the only BAS row
-- company-wide with the wrong category). This silently dropped its 9 sqm
-- from every category-filtered report (By Item & Type, Agent Commission).
-- Safe, isolated, doesn't touch any amount/qty — just the taxonomy tag.
UPDATE sales_order_items
SET category = 'BOOTH'
WHERE id IN (
  SELECT soi.id FROM sales_order_items soi
  WHERE soi.sales_order_id = '28f6e0c6-1b2f-405a-b49a-1f01f0685d34'
    AND soi.sales_item_code = 'BAS' AND soi.category = 'OTHER'
);

-- NOT included here: two other MIFB27 contracts (DONG JIA HUAT PLANTATION,
-- CHEF WAN GROUP OF RESTAURANTS) whose total_sqm=18 no longer matches their
-- currently-active Floor Plan booth claims (down to 9, after one of their
-- two originally-picked booths was lost/deselected) — AND whose billing
-- line items still carry a full duplicated set (2x BAS/COR/LOD/MEP) as if
-- both booths were still held. CHEF WAN's has already been invoiced and
-- CONFIRMED (RM16,751.20) — this needs the user's own review before
-- anything touches it, not a blind data migration.
