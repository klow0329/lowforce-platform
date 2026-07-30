-- Sales Agent grows from a bare name+commission-rate list into a real
-- company-profile record, same shape as Exhibitor's own company-info
-- fields (minus contacts/billing/segments, which an agent doesn't need).
ALTER TABLE agents ADD COLUMN name_alt      TEXT;
ALTER TABLE agents ADD COLUMN country_code  TEXT REFERENCES countries(code);
ALTER TABLE agents ADD COLUMN address       TEXT;
ALTER TABLE agents ADD COLUMN postcode      TEXT;
ALTER TABLE agents ADD COLUMN city          TEXT;
ALTER TABLE agents ADD COLUMN state         TEXT;
ALTER TABLE agents ADD COLUMN salesperson_id UUID REFERENCES users(id);
ALTER TABLE agents ADD COLUMN reg_no        TEXT;
ALTER TABLE agents ADD COLUMN tin_no        TEXT;
ALTER TABLE agents ADD COLUMN sst_no        TEXT;
ALTER TABLE agents ADD COLUMN website       TEXT;
ALTER TABLE agents ADD COLUMN fax           TEXT;
