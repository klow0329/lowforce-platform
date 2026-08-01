-- Foundational schema for an optional Group layer above Company, added ahead
-- of more Phase 1 screens being built on top of the current structure so it
-- never needs retrofitting later (user-confirmed standing decision,
-- 2026-07-31 — see CLAUDE.md). Purely additive: no existing query changes
-- behavior, since group_id is nullable and nothing reads it yet.
CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Nullable — a company can stand alone with no group (every company today,
-- and any new one going forward, unless deliberately linked) or belong to
-- one. Every existing company_id-scoped query keeps working exactly as-is.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id);
CREATE INDEX IF NOT EXISTS idx_companies_group_id ON companies(group_id);

-- A user with this set can see combined/consolidated data across every
-- company under their own company's group, in addition to their normal
-- single-company access — derived via company_id -> group_id, not a
-- separate grant, since "their group" is unambiguous. No consuming
-- query/middleware logic reads this yet (no consolidated views exist yet,
-- per the user's explicit "not built yet" scope) — this is the access-flag
-- foundation only, so it doesn't need to be retrofitted onto the users
-- table later.
ALTER TABLE users ADD COLUMN IF NOT EXISTS has_group_access BOOLEAN NOT NULL DEFAULT FALSE;

-- Seed: the real current setup already reflects Group -> Company -> Events
-- -> everything else.
INSERT INTO groups (name, slug) VALUES ('One International Group', 'one-international-group')
ON CONFLICT (slug) DO NOTHING;

UPDATE companies
SET group_id = (SELECT id FROM groups WHERE slug = 'one-international-group')
WHERE id = '00000000-0000-0000-0000-000000000001' AND group_id IS NULL;
