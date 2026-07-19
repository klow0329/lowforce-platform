-- Seed tax codes, exchange rate, and backfill price_list categories/defaults.

DO $$
DECLARE
  co_id UUID := '00000000-0000-0000-0000-000000000001';
  sv6_id UUID;
BEGIN
  INSERT INTO tax_codes (company_id, code, name, rate_pct) VALUES
    (co_id, 'SV-6', 'Sales Tax 6%', 6.00),
    (co_id, 'SV-8', 'Sales Tax 8%', 8.00),
    (co_id, 'NTS', 'No Tax / Not Taxable', 0.00)
  ON CONFLICT (company_id, code) DO NOTHING;

  SELECT id INTO sv6_id FROM tax_codes WHERE company_id = co_id AND code = 'SV-6';

  INSERT INTO company_settings (company_id, usd_to_myr_rate)
  VALUES (co_id, 4.0)
  ON CONFLICT (company_id) DO NOTHING;

  -- BOOTH items per the product catalogue; everything else is OTHER.
  UPDATE price_list SET category = 'BOOTH'
  WHERE company_id = co_id AND sales_item_code IN ('BAS','SSS','ESS','WOP','CUB');
  UPDATE price_list SET category = 'OTHER'
  WHERE company_id = co_id AND sales_item_code NOT IN ('BAS','SSS','ESS','WOP','CUB');

  -- Default tax on every price list item is SV-6 (6%), per the user's stated default.
  UPDATE price_list SET default_tax_code_id = sv6_id WHERE company_id = co_id;
END $$;
