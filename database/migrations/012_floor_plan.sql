-- Floor Plan module (Phase 1): per-event halls with a real scanned floor
-- plan image as backdrop, and a booth list configured as a table (not a
-- drag/drop canvas — Operations already edits the master layout in
-- Illustrator and exports a PDF; this just needs to mirror booth
-- number/position/status for the rest of the system to use).
-- Booth position is stored as a percentage of the image's own width/height
-- rather than real-world metres, so it renders correctly regardless of the
-- uploaded image's resolution and needs no separate calibration step.
CREATE TABLE floor_plan_halls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  event_id UUID NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  background_filename TEXT,
  background_original_filename TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE floor_plan_booths (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hall_id UUID NOT NULL REFERENCES floor_plan_halls(id) ON DELETE CASCADE,
  booth_no TEXT NOT NULL,
  x_pct NUMERIC(6,3) NOT NULL,
  y_pct NUMERIC(6,3) NOT NULL,
  width_pct NUMERIC(6,3) NOT NULL,
  height_pct NUMERIC(6,3) NOT NULL,
  sqm NUMERIC(8,2),
  -- Loading/corner are auto-suggested when booths are grid-generated (edge
  -- column = loading, grid corner = corner) but always editable per booth —
  -- Operations may decide a given corner/aisle unit isn't actually charged.
  is_corner BOOLEAN NOT NULL DEFAULT FALSE,
  is_loading BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'AVAILABLE', -- AVAILABLE / RESERVED / SOLD
  sales_order_id UUID REFERENCES sales_orders(id),
  assigned_exhibitor_name TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hall_id, booth_no)
);

CREATE INDEX idx_floor_plan_booths_hall ON floor_plan_booths(hall_id);
CREATE INDEX idx_floor_plan_halls_event ON floor_plan_halls(event_id);
