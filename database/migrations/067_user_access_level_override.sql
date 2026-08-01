-- Per-user access level override (Round D-5 #7, user-confirmed design):
-- a simple, whole-account override — no per-module selection — that when
-- set overrides the user's Department-level per-module matrix (see
-- roles.permissions / modulePermission.js) across all 4 gated modules
-- (Exhibitors/Opportunities/Contracts/Invoices). NULL ("Default") falls
-- back to the Department matrix exactly as before this feature.
ALTER TABLE users ADD COLUMN IF NOT EXISTS access_level_override TEXT
  CHECK (access_level_override IN ('VIEW_ONLY', 'VIEW_ADD', 'FULL_EDIT'));
