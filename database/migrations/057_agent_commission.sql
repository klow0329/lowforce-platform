-- Agent commission — company said this is a genuinely per-agent, per-
-- revenue-category, per-exhibitor-tier arrangement (e.g. 15% on Bare Space
-- for a repeat exhibitor vs 20% for a new one, with room to add more rows
-- later — a different rate on non-booth items, or a further tier), not a
-- single flat number — so it's modeled as an open rate table per agent
-- rather than a couple of fixed columns, same "admin adds a row, no code
-- change" spirit as the Price List's own generic item config.
--
-- is_repeat_exhibitor is set in bulk by importing last year's exhibitor
-- list (matched by company name — see exhibitors.controller.js's
-- importRepeatExhibitors) and can be corrected by hand afterward on the
-- Exhibitor's own record, same as any other field.
ALTER TABLE exhibitors ADD COLUMN is_repeat_exhibitor BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE agent_commission_rates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id),
    agent_id        UUID NOT NULL REFERENCES agents(id),
    -- Matches sales_order_items.category ('BOOTH' or 'OTHER') so the rate
    -- naturally lines up with the same booth-vs-non-booth split already
    -- used everywhere else in billing — no new taxonomy to maintain.
    category        TEXT NOT NULL,
    -- 'REPEAT' or 'NEW' today; free text so a company can introduce a
    -- further tier later without a schema change.
    exhibitor_tier  TEXT NOT NULL,
    rate_pct        NUMERIC(5,2) NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (agent_id, category, exhibitor_tier)
);
CREATE INDEX idx_agent_commission_rates_agent ON agent_commission_rates(agent_id);
