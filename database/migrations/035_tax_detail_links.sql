-- Self-service tax-detail collection link (item 3): a Sales user generates
-- a one-time, expiring link and sends it to the exhibitor (via their own
-- Outlook), who fills in SSM/TIN/address/contact details without needing a
-- LowForce login. The token itself is the only security — long, random,
-- single-use, and time-limited — same mechanism as a password-reset email.
CREATE TABLE tax_detail_links (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL REFERENCES companies(id),
    exhibitor_id UUID NOT NULL REFERENCES exhibitors(id),
    token       TEXT NOT NULL UNIQUE,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ
);
CREATE INDEX idx_tax_detail_links_token ON tax_detail_links (token);
CREATE INDEX idx_tax_detail_links_exhibitor ON tax_detail_links (exhibitor_id);
