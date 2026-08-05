-- Self-service "Forgot Password" (2026-08-05) — same one-time, expiring,
-- single-use token pattern as tax_detail_links, just much shorter-lived
-- (60 minutes, not 5 days — a password reset link is a higher-value target
-- if intercepted than a tax-detail form link).
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id),
    token       TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
