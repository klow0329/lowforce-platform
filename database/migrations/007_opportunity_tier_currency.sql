-- Opportunities gain the same Tier/Currency fields as Contracts, so the
-- estimate carries forward cleanly on "Generate Contract" and both stages
-- present the same dropdown-driven, typo-proof selections.
ALTER TABLE opportunities
  ADD COLUMN booking_type TEXT,           -- rate tier: PUBLISHED RATE / EARLY BIRD / ONSITE REBOOKING / CONTRA
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'MYR';
