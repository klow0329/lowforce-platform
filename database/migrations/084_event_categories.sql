-- Reworks "sub-event" (Category) from a year-suffixed child EVENT row
-- (MCE26, MYFT26 — recreated every year) into a reusable, year-independent
-- TAG scoped to a Main (MCE, MYFT — created once, applied every year).
-- 2026-08-05, user's explicit direction: "just like MYFT not MYFT26
-- anymore... so it can apply across all different year without creating
-- new" — plus reporting per sub-event only makes sense against the actual
-- per-year contract data, so the tag is applied PER PARTICIPATION
-- (exhibitor_events / opportunities / sales_orders), never baked into the
-- event/tier hierarchy itself.
--
-- Schema-only and fully generic — safe for any company, creates nothing by
-- itself. Converting ExpoCO's existing MCE26/MYFT26 category-tier events
-- into actual event_categories rows (and repointing the ~800 real contract/
-- invoice/payment/access rows that reference them) is a separate, explicit,
-- verified data step — not something this migration guesses at, per
-- CLAUDE.md rule #2, and because real financial data is involved.
CREATE TABLE IF NOT EXISTS event_categories (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id     UUID NOT NULL REFERENCES companies(id),
    main_event_id  UUID NOT NULL REFERENCES events(id), -- must be tier='MAIN', enforced in the controller (Postgres CHECK can't see a sibling row's tier)
    code           TEXT NOT NULL,
    name           TEXT NOT NULL,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order     INT NOT NULL DEFAULT 0,
    UNIQUE (company_id, main_event_id, code)
);

-- Reporting anchors: revenue/sqm/booth data lives on opportunities and
-- sales_orders, so the tag goes there directly rather than only on
-- exhibitor_events — a report grouping "MYFT revenue in 2026" needs this
-- without an extra join back through participation. Invoices/payments/
-- credit_notes deliberately do NOT get their own category_id — they join
-- back to sales_orders.category_id, so editing a contract's category never
-- leaves its own invoices pointing at a stale value.
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES event_categories(id);
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES event_categories(id);

-- Exhibitor's own per-year participation record (migration 078) — the
-- "which events, and optionally which sub-event, is this exhibitor part of"
-- list shown on the Exhibitor's own detail page, independent of whether a
-- contract exists yet.
ALTER TABLE exhibitor_events ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES event_categories(id);

-- Agent <-> Main event (2026-08-05, user's explicit direction): a standing
-- fact about the agent, not per-year — "imagine like SIAL international,
-- which [runs] across the region with different events" — so one agent can
-- be linked to MULTIPLE Main events, hence a join table, not a single FK
-- column on agents.
CREATE TABLE IF NOT EXISTS agent_main_events (
    agent_id       UUID NOT NULL REFERENCES agents(id),
    main_event_id  UUID NOT NULL REFERENCES events(id), -- must be tier='MAIN', enforced in the controller
    PRIMARY KEY (agent_id, main_event_id)
);
