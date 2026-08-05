-- Formalizes the events hierarchy into three explicit tiers (2026-08-05,
-- user-specified structure): MAIN (a brand, e.g. "MIFB", no year) ->
-- EDITION (a specific year's instance, e.g. "MIFB27") -> CATEGORY (a
-- sub-event within that edition, e.g. "MCE26"/"MYFT26"). Reuses the
-- existing parent_event_id self-reference (no new table) — just makes the
-- tier explicit instead of inferring it from "has a parent or not", which
-- only ever supported 2 levels.
--
-- Backward compatible by construction: every existing event defaults to
-- EDITION (today's top-level events keep working exactly as they did —
-- nothing forces a Main to exist), and every event that already had a
-- parent (today's sub-events) becomes CATEGORY, preserving current
-- behavior. Introducing an actual MAIN row for a given company is a
-- separate, explicit, per-company action (Admin > Events), never inferred
-- automatically — a second company's naming scheme can't be guessed at
-- (per CLAUDE.md rule #2).
ALTER TABLE events ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'EDITION' CHECK (tier IN ('MAIN', 'EDITION', 'CATEGORY'));
UPDATE events SET tier = 'CATEGORY' WHERE parent_event_id IS NOT NULL AND tier = 'EDITION';

-- Edition-level venue (item 4: Application Form's Section 1 ties to the
-- event's venue). Nullable/free text — only meaningful for EDITION rows,
-- not enforced at the DB level since Postgres CHECK constraints can't see
-- sibling rows' tier; enforced in the controller instead.
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue TEXT;

-- Per-MAIN event logo (2026-08-05: "for every main event created, will
-- trigger another area to upload logo... each logo should label and tie to
-- the main event"). Replaces the old single global
-- company_settings.event_logo_filename slot, which had no way to
-- distinguish one Main from another once a company runs more than one.
-- That column is NOT dropped — it remains the fallback for an EDITION with
-- no MAIN parent (a company that never introduces the Main tier keeps
-- working exactly as before), only superseded when an Edition actually has
-- a MAIN ancestor with its own logo set.
ALTER TABLE events ADD COLUMN IF NOT EXISTS logo_filename TEXT;
