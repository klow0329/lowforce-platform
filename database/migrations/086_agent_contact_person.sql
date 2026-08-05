-- Agent had no contact-person fields at all (only the company-level profile
-- from migration 048) — every other party in the system (Exhibitor) already
-- carries a named contact, and an agent needs one too for day-to-day
-- correspondence. Single contact (not Exhibitor's contact1/contact2 pair) —
-- an agent relationship is normally one point of contact.
ALTER TABLE agents ADD COLUMN contact_name      TEXT;
ALTER TABLE agents ADD COLUMN contact_job_title TEXT;
ALTER TABLE agents ADD COLUMN contact_phone     TEXT;
ALTER TABLE agents ADD COLUMN contact_email     TEXT;
