-- Audit trail for platform-owner actions (registering/suspending a company,
-- creating a group, bootstrapping a tenant's first Admin).
--
-- A separate table from `audit_log` because that one's `company_id` is NOT
-- NULL and FK-constrained: platform actions frequently have no company at
-- all (creating a group), or act ON a company rather than inside it. Its
-- `company_id` here is a nullable reference for context, never a tenant
-- scope — these rows are the operator's own trail and are deliberately not
-- visible from any tenant's Audit Log screen.
CREATE TABLE IF NOT EXISTS platform_audit_log (
  id                 BIGSERIAL PRIMARY KEY,
  platform_admin_id  UUID REFERENCES platform_admins(id),
  admin_email        TEXT,          -- denormalised so the trail survives account deletion
  action             TEXT NOT NULL, -- LOGIN / COMPANY_CREATE / COMPANY_SUSPEND / ...
  entity_type        TEXT,          -- 'company' | 'group' | 'user'
  entity_id          UUID,
  company_id         UUID REFERENCES companies(id),
  details            JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_time ON platform_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_entity ON platform_audit_log(entity_type, entity_id);

-- Suspension needs a reason and a timestamp — "why is this tenant off?" is
-- the first question anyone asks, and it should not live only in someone's
-- memory or a support email.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
