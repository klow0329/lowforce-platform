-- The Value Change ("Contract Reduction") booth adjuster was release-only —
-- Sales could shrink a contract's booth set but never grow it, and was
-- capped at the contract's own current sqm while doing so. The user
-- explicitly asked for the SAME add/change/remove freedom the Opportunity/
-- draft Contract booth picker already has (2026-08-01). Booths newly picked
-- there that weren't already linked to the contract are staged here and
-- actually claimed on approval (see approveContractReduction) — mirrors how
-- released_booth_ids/booth_item_codes stage the other two kinds of change.
ALTER TABLE contract_reductions ADD COLUMN added_booth_ids UUID[] NOT NULL DEFAULT '{}';
