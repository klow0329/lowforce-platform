-- Redesign of the Agent Commission rate table per the user's own request:
-- rates now key on a SPECIFIC Price List item code (or 'ALL' as a
-- catch-all), not a broad Booth/Non-Booth bucket, and a new bonus-tier
-- table lets an agent earn extra % once their revenue or sqm for the event
-- crosses a threshold. The table was still empty in production (this
-- feature shipped last round with nobody having configured a rate yet), so
-- this is a straight rename, not a data migration.
ALTER TABLE agent_commission_rates RENAME COLUMN category TO item_code;

CREATE TABLE agent_commission_bonus_tiers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id),
    agent_id        UUID NOT NULL REFERENCES agents(id),
    threshold_type  TEXT NOT NULL CHECK (threshold_type IN ('REVENUE_MYR', 'SQM')),
    threshold_value NUMERIC(14,2) NOT NULL,
    bonus_pct       NUMERIC(5,2) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_agent_commission_bonus_tiers_agent ON agent_commission_bonus_tiers(agent_id);

-- comm_rate (the old single flat rate on the agent record itself) is
-- retired from the Admin UI/API in favour of the rate table above — left in
-- place on disk (unused going forward) rather than dropped, same pattern as
-- the LOD fallback field.
