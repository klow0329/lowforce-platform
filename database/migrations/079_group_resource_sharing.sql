-- Phase 1 of group resource sharing: let companies under the same Group
-- see each other's exhibitors in SEARCH ONLY (read-only, not openable),
-- so a rep can tell "this company is already being handled by ExpoCO,
-- salesperson X, event Y" instead of blindly re-creating it.
--
-- Modelled on SAP's customer master split: General Data is shared at
-- client (= Group) level, while Company Code Data (billing, AR, credit)
-- and the documents themselves stay strictly per company. This migration
-- only enables the SHARED-IDENTITY half — every existing company_id filter
-- (381 of them across 27 controllers) is left exactly as-is. Group sharing
-- is a narrow additive read path, never a relaxation of tenant isolation.
--
-- Keyed by resource_type rather than a boolean column so the planned
-- Vendor list (Operations invoicing) plugs in with NO schema change —
-- just a new resource_type value.
CREATE TABLE IF NOT EXISTS company_group_sharing (
  company_id     UUID NOT NULL REFERENCES companies(id),
  resource_type  TEXT NOT NULL,           -- 'EXHIBITORS' today; 'VENDORS' next
  is_shared      BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by     UUID REFERENCES users(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, resource_type)
);

CREATE INDEX IF NOT EXISTS idx_company_group_sharing_lookup
  ON company_group_sharing(resource_type, is_shared);

-- Deliberately NOT seeded to TRUE for anyone.
--
-- Sharing exhibitor identity across separate legal entities is a decision
-- an Admin should make knowingly, not something that silently switches on
-- during an upgrade — especially since LowForce is sold to unrelated
-- groups where subsidiaries may be genuinely independent businesses.
-- Every company therefore starts opted OUT (absent row = not shared) and
-- turns it on from Admin > Company Profile in one click.
