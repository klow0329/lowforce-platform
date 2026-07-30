// Shared by FloorPlan.jsx (normal view) and FloorPlanPresentation.jsx — the
// booth label is two fixed "paragraphs": the booth number always renders at
// BOOTH_NUMBER_FS regardless of that booth's own box size or the exhibitor
// name's length (matching printed floor plans, where every booth number
// reads the same size at a glance), and the exhibitor name wraps in
// whatever room is left underneath it, shrinking only as far as it needs to
// fit that remaining space (see fitBoothName). A tiny booth's number can get
// clipped by the box's own overflow:hidden at low zoom — zooming in is the
// intended way to read it, the same way a printed floor plan needs a loupe
// for its smallest booths rather than shrinking every number to the
// smallest box on the sheet.
const CHAR_W_RATIO = 0.58; // approx average glyph width as a fraction of font size, typical sans-serif
const LINE_H_RATIO = 1.15;

export const BOOTH_NUMBER_FS = 12;

// Largest font size (down to a 5px floor) at which `name`, wrapped across as
// many lines as needed, fits within availW x availH.
export function fitBoothName(name, availW, availH) {
  if (!name) return 0;
  const maxFs = 9;
  const minFs = 5;
  for (let fs = maxFs; fs >= minFs; fs -= 0.5) {
    const colsPerLine = Math.max(1, Math.floor((availW - 2) / (fs * CHAR_W_RATIO)));
    const lines = Math.ceil(name.length / colsPerLine);
    if (lines * fs * LINE_H_RATIO <= availH) return fs;
  }
  return minFs;
}
