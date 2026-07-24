-- Indexes on the columns actually filtered on in every list/report query
-- (company_id + event_id together, since almost every screen scopes by
-- both) — these were missing on the busiest tables. Cheap to add now while
-- tables are small; expensive to discover missing once they're not.
CREATE INDEX idx_sales_orders_company_event ON sales_orders(company_id, event_id);
CREATE INDEX idx_sales_orders_opportunity ON sales_orders(opportunity_id);
CREATE INDEX idx_invoices_company_event ON invoices(company_id, event_id);
CREATE INDEX idx_invoices_sales_order ON invoices(sales_order_id);
CREATE INDEX idx_invoices_exhibitor ON invoices(exhibitor_id);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);
-- exhibitor_events' PK is (exhibitor_id, event_id) — already indexes
-- exhibitor_id-first lookups, just not event_id on its own.
CREATE INDEX idx_exhibitor_events_event ON exhibitor_events(event_id);
CREATE INDEX idx_floor_plan_booths_opportunity ON floor_plan_booths(opportunity_id);
CREATE INDEX idx_floor_plan_booths_sales_order ON floor_plan_booths(sales_order_id);
