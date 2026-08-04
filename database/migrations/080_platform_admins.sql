-- Platform-owner console: the LowForce operator's own account, deliberately
-- OUTSIDE the tenant model.
--
-- Why a separate table rather than a flag on `users`:
--   1. `users` is company-scoped (UNIQUE company_id+email) and every tenant
--      query joins it. A cross-tenant superuser living there would be a row
--      some company's Admin could see, deactivate, or reassign — the exact
--      "protect me from a customer taking over ownership" problem raised.
--   2. Isolation becomes structural instead of conditional. Tenant routes
--      require `req.session.user`; platform routes require
--      `req.session.platformAdmin`. Neither key can satisfy the other's
--      middleware, so there is no flag to accidentally mis-check and no
--      privilege-escalation path from inside a tenant.
--   3. Registering companies/groups is a commercial act (licensing,
--      billing), not something a customer Admin should ever self-serve —
--      especially now that group membership grants cross-company
--      visibility (migration 079).
CREATE TABLE IF NOT EXISTS platform_admins (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  full_name      TEXT NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Legal-entity identity for the companies the operator registers. `name`
-- and `slug` already existed but carried no real-world identity — you
-- cannot tell two similarly named subsidiaries apart, or reconcile a
-- tenant against a real company, without these.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS reg_no TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS country_code TEXT REFERENCES countries(code);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ;

ALTER TABLE groups ADD COLUMN IF NOT EXISTS reg_no TEXT;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS country_code TEXT REFERENCES countries(code);
ALTER TABLE groups ADD COLUMN IF NOT EXISTS notes TEXT;

-- No admin is seeded here on purpose — a hardcoded credential in a
-- migration is exactly the kind of thing that survives into production.
-- Create the first one with:
--   node backend/scripts/create-platform-admin.js <email> "<Full Name>"
-- which generates a strong random password and prints it once.
