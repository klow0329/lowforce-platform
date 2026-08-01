-- Approval Rules v2 — additions confirmed by the user after a survey of
-- well-known systems (Salesforce/NetSuite/DocuSign-style approval patterns):
-- backup/delegate approver, escalation on timeout, per-event rule scoping,
-- and sequential 2-step approval for the highest revenue tier. All columns
-- are nullable/opt-in — an existing rule with none of these set behaves
-- exactly as it did before this migration.
ALTER TABLE approval_rules
  -- NULL = applies company-wide (unchanged default); set = this rule only
  -- fires for that specific event, letting different events use different
  -- thresholds/approvers.
  ADD COLUMN event_id UUID REFERENCES events(id),
  -- Can also approve/reject at this tier, in addition to the primary
  -- approver — not conditional on the primary being "away" (no such flag
  -- exists), just a second person who's always allowed to act so a request
  -- never sits stuck on one person's availability.
  ADD COLUMN backup_approver_user_id UUID REFERENCES users(id),
  -- If a request has been sitting pending this many days, whoever's set
  -- below also becomes allowed to act on it (in addition to the primary/
  -- backup) — the fallback rung of the ladder for a truly stuck request.
  ADD COLUMN escalate_after_days INTEGER,
  ADD COLUMN escalate_to_role_code TEXT,
  ADD COLUMN escalate_to_user_id UUID REFERENCES users(id),
  -- Sequential 2nd approval step — only meaningful for
  -- REVENUE_ABOVE_THRESHOLD today (see approvals.controller.js). When set,
  -- the primary approver's action moves the contract to
  -- PENDING_APPROVAL_STEP2 instead of APPROVED; only this step-2
  -- approver (or Admin) can then finalize it.
  ADD COLUMN step2_approver_role_code TEXT,
  ADD COLUMN step2_approver_user_id UUID REFERENCES users(id);
