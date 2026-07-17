-- ============================================================================
-- Seed data — one starter company (One International) with sensible defaults.
-- These defaults are a STARTING POINT, not a fixed rule — every value here
-- can be edited later through the Admin module without touching code.
-- ============================================================================

INSERT INTO companies (id, name, slug) VALUES
    ('00000000-0000-0000-0000-000000000001', 'One International Group', 'one-international');

-- Default roles (matches the current 6-division structure, editable later)
INSERT INTO roles (company_id, code, name, sort_order) VALUES
    ('00000000-0000-0000-0000-000000000001', 'ADM',   'Admin',        1),
    ('00000000-0000-0000-0000-000000000001', 'MGT',   'Management',   2),
    ('00000000-0000-0000-0000-000000000001', 'SALES', 'Sales',        3),
    ('00000000-0000-0000-0000-000000000001', 'FIN',   'Finance',      4),
    ('00000000-0000-0000-0000-000000000001', 'OPS',   'Operations',   5),
    ('00000000-0000-0000-0000-000000000001', 'MKT',   'Marketing',    6);

-- Sample event
INSERT INTO events (id, company_id, code, name, event_year, is_active) VALUES
    ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'MIFB26', 'MIFB 2026', 2026, TRUE);

-- Default sales pipeline stages (matches current Excel STG10/40/80/WON/LOSE)
INSERT INTO sales_stages (company_id, code, name, probability_pct, sort_order, is_won, is_lost) VALUES
    ('00000000-0000-0000-0000-000000000001', 'STG10', 'Initial Contact', 10, 1, FALSE, FALSE),
    ('00000000-0000-0000-0000-000000000001', 'STG40', 'Proposal Sent',   40, 2, FALSE, FALSE),
    ('00000000-0000-0000-0000-000000000001', 'STG80', 'Verbal Confirm',  80, 3, FALSE, FALSE),
    ('00000000-0000-0000-0000-000000000001', 'WON',   'Won',            100, 4, TRUE,  FALSE),
    ('00000000-0000-0000-0000-000000000001', 'LOSE',  'Lost',             0, 5, FALSE, TRUE);

-- Default AR aging buckets (matches current 30/60/90/120 pattern)
INSERT INTO aging_buckets (company_id, label, min_days, max_days, sort_order) VALUES
    ('00000000-0000-0000-0000-000000000001', '0-30 days',    0,  30, 1),
    ('00000000-0000-0000-0000-000000000001', '31-60 days',  31,  60, 2),
    ('00000000-0000-0000-0000-000000000001', '61-90 days',  61,  90, 3),
    ('00000000-0000-0000-0000-000000000001', '91-120 days', 91, 120, 4),
    ('00000000-0000-0000-0000-000000000001', '120+ days',  121, NULL, 5);

-- A small set of common countries to start with (add more as needed)
INSERT INTO countries (code, name) VALUES
    ('MY', 'Malaysia'), ('SG', 'Singapore'), ('CN', 'China'),
    ('ID', 'Indonesia'), ('TH', 'Thailand'), ('VN', 'Vietnam'),
    ('IN', 'India'), ('US', 'United States'), ('GB', 'United Kingdom')
ON CONFLICT DO NOTHING;

-- Sample agents (company-configurable, editable later via Admin)
INSERT INTO agents (company_id, name, comm_rate) VALUES
    ('00000000-0000-0000-0000-000000000001', 'ASEAN Trade Partners', 5.00),
    ('00000000-0000-0000-0000-000000000001', 'Golden Bridge Agency',  7.50);

-- Sample industry segments (main + sub), matching the exhibition's F&B focus
INSERT INTO segment_main (id, company_id, code, name) VALUES
    ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000001', 'FOOD', 'Food & Beverage'),
    ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000001', 'PKG',  'Packaging'),
    ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000001', 'TECH', 'Food Technology'),
    ('00000000-0000-0000-0000-000000000204', '00000000-0000-0000-0000-000000000001', 'SVC',  'Services');

INSERT INTO segment_sub (company_id, segment_main_id, code, name) VALUES
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000201', 'HALAL',  'Halal Food'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000201', 'FROZEN', 'Frozen Food'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000201', 'SNACK',  'Snacks & Confectionery'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000201', 'BEV',    'Beverages'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000202', 'FPKG',   'Food Packaging'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000202', 'IPKG',   'Industrial Packaging'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000203', 'PROC',   'Processing Equipment'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000203', 'COLD',   'Cold Chain'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000204', 'LOGI',   'Logistics'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000204', 'CERT',   'Certification');

-- NOTE: no user is seeded here with a real password on purpose.
-- Create the first admin user via the signup/setup script once the backend
-- is running, so the password is hashed properly rather than hardcoded here.
