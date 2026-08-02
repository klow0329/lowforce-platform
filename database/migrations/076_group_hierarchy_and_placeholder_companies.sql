-- Corrects the org hierarchy to match the real structure and adds a second
-- Group level above the existing one (Group -> Group -> Company), per the
-- user's explicit 2026-08-02 request:
--   Catcha Group (ultimate parent)
--     -> One International Group
--        -> ExpoCO Sdn Bhd (the existing seed company, renamed — it was
--           previously named "One International Group" itself, which
--           collided with the group of the same name added in migration
--           068; the GROUP keeps that name, the COMPANY is renamed to its
--           real name)
--        -> Company 2..5 (placeholder shells for the other event
--           subsidiaries, to be renamed when each one actually onboards —
--           per the standing "seed data only, never hardcoded" rule, these
--           are just rows like any other company, with zero special-cased
--           logic anywhere in the app)
--
-- Visibility is unaffected: every existing company_id-scoped query still
-- only sees its own company's rows regardless of group nesting depth — no
-- code anywhere reads group_id/parent_group_id yet (same "foundation only"
-- status migration 068 established). A future "group admin" consolidated
-- view is still not built; this migration only fixes the data shape it
-- would need.

ALTER TABLE groups ADD COLUMN IF NOT EXISTS parent_group_id UUID REFERENCES groups(id);
CREATE INDEX IF NOT EXISTS idx_groups_parent_group_id ON groups(parent_group_id);

DO $$
DECLARE
  catcha_id UUID;
  one_intl_group_id UUID;
  expoco_company_id UUID := '00000000-0000-0000-0000-000000000001';
  new_company_ids UUID[] := ARRAY[
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000005'
  ];
  new_company_names TEXT[] := ARRAY['Company 2', 'Company 3', 'Company 4', 'Company 5'];
  new_company_slugs TEXT[] := ARRAY['company-2', 'company-3', 'company-4', 'company-5'];
  cid UUID;
  i INT;
BEGIN
  -- Catcha Group: ultimate parent, no group above it.
  INSERT INTO groups (name, slug) VALUES ('Catcha Group', 'catcha-group')
  ON CONFLICT (slug) DO NOTHING;
  SELECT id INTO catcha_id FROM groups WHERE slug = 'catcha-group';

  -- One International Group now sits under Catcha Group instead of being
  -- the top of the tree.
  SELECT id INTO one_intl_group_id FROM groups WHERE slug = 'one-international-group';
  UPDATE groups SET parent_group_id = catcha_id WHERE id = one_intl_group_id;

  -- The existing seed company was itself named "One International Group",
  -- which is really the GROUP's name, not this individual company's —
  -- corrected to its actual name.
  UPDATE companies
  SET name = 'ExpoCO Sdn Bhd', slug = 'expoco'
  WHERE id = expoco_company_id AND name = 'One International Group';

  -- Four placeholder companies for the other event subsidiaries, all under
  -- the same One International Group — real names/branding to be filled in
  -- when each one actually onboards.
  FOR i IN 1..4 LOOP
    cid := new_company_ids[i];
    INSERT INTO companies (id, name, slug, group_id)
    VALUES (cid, new_company_names[i], new_company_slugs[i], one_intl_group_id)
    ON CONFLICT (id) DO NOTHING;

    -- Same starter shell every new company gets (matches seed.sql's
    -- pattern for the first company) — default role taxonomy, pipeline
    -- stages, and aging buckets, all editable per company via Admin.
    -- Without at least the ADM role existing, there'd be no role to assign
    -- whenever this company's first real user actually gets created.
    INSERT INTO roles (company_id, code, name, sort_order) VALUES
      (cid, 'ADM',   'Admin',        1),
      (cid, 'MGT',   'Management',   2),
      (cid, 'SALES', 'Sales',        3),
      (cid, 'FIN',   'Finance',      4),
      (cid, 'OPS',   'Operations',   5),
      (cid, 'MKT',   'Marketing',    6)
    ON CONFLICT (company_id, code) DO NOTHING;

    INSERT INTO sales_stages (company_id, code, name, probability_pct, sort_order, is_won, is_lost) VALUES
      (cid, 'STG10', 'Initial Contact', 10, 1, FALSE, FALSE),
      (cid, 'STG40', 'Proposal Sent',   40, 2, FALSE, FALSE),
      (cid, 'STG80', 'Verbal Confirm',  80, 3, FALSE, FALSE),
      (cid, 'WON',   'Won',            100, 4, TRUE,  FALSE),
      (cid, 'LOSE',  'Lost',             0, 5, FALSE, TRUE)
    ON CONFLICT (company_id, code) DO NOTHING;

    INSERT INTO aging_buckets (company_id, label, min_days, max_days, sort_order) VALUES
      (cid, '0-30 days',    0,  30, 1),
      (cid, '31-60 days',  31,  60, 2),
      (cid, '61-90 days',  61,  90, 3),
      (cid, '91-120 days', 91, 120, 4),
      (cid, '120+ days',  121, NULL, 5)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
