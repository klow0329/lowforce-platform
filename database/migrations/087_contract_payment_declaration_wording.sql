-- Contract redesign (2026-08-05): the Payment Terms and Exhibitor's
-- Declaration paragraphs printed on the Contract were the only remaining
-- hardcoded legal wording on that document (everything else already reads
-- from company_settings) — a second company's payment terms or declaration
-- language has no reason to match ExpoCO's. Both editable via Admin >
-- Company Profile, same pattern as the existing contract_terms field.
-- DEFAULT seeds every company (new and existing) with generic starter
-- wording (no company names/bank details baked in — those already come
-- from this same table's own bank_name/account fields at print time) that
-- reads sensibly out of the box and can be edited or cleared per company.
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS payment_terms_wording TEXT
  DEFAULT 'Payment terms: 100% of the Participation Fees is due within 14 days of the Event Organiser''s acceptance of this application, unless otherwise stated in the Event Organiser''s invoice. Late payment interest: 1% per month. All bank charges are borne by the remitter.';
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS declaration_wording TEXT
  DEFAULT 'We, the undersigned, being duly authorised, hereby apply for the Booked Space set out above. We acknowledge and agree that: (a) this Application Form constitutes an irrevocable offer by us to book the Booked Space on the terms of the Contract Documents listed in the Terms & Conditions; (b) a binding contract is formed only upon the Event Organiser''s acceptance of this application, which the Event Organiser may give or withhold at its sole discretion; and (c) this application must be returned within 14 days of the date of issue, failing which any provisionally reserved space may be released.';

-- Backfill existing rows — DEFAULT only applies to rows inserted after this
-- migration runs, and every company already has a company_settings row.
UPDATE company_settings SET payment_terms_wording = 'Payment terms: 100% of the Participation Fees is due within 14 days of the Event Organiser''s acceptance of this application, unless otherwise stated in the Event Organiser''s invoice. Late payment interest: 1% per month. All bank charges are borne by the remitter.'
  WHERE payment_terms_wording IS NULL;
UPDATE company_settings SET declaration_wording = 'We, the undersigned, being duly authorised, hereby apply for the Booked Space set out above. We acknowledge and agree that: (a) this Application Form constitutes an irrevocable offer by us to book the Booked Space on the terms of the Contract Documents listed in the Terms & Conditions; (b) a binding contract is formed only upon the Event Organiser''s acceptance of this application, which the Event Organiser may give or withhold at its sole discretion; and (c) this application must be returned within 14 days of the date of issue, failing which any provisionally reserved space may be released.'
  WHERE declaration_wording IS NULL;
