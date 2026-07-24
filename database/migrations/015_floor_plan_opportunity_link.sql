-- A booth picked from an Opportunity that hasn't become a signed Contract
-- yet needs its own link (separate from sales_order_id) and its own status
-- so it isn't shown as sold prematurely — and, per real testing, so it can
-- be safely released if the Opportunity is never actually saved or later
-- falls through. "RESERVED" is renamed to "PROPOSED" to read correctly
-- next to "SOLD" (a Contract-linked booth).
ALTER TABLE floor_plan_booths
  ADD COLUMN opportunity_id UUID REFERENCES opportunities(id);

UPDATE floor_plan_booths SET status = 'PROPOSED' WHERE status = 'RESERVED';
