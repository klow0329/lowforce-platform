// Shared by FloorPlan.jsx (normal view) and FloorPlanPresentation.jsx — the
// booth label is two fixed "paragraphs": the booth number, and (below it)
// the exhibitor name. The name always shrinks independently to fit whatever
// room is left under the number (see fitBoothName) — it is never what
// decides the number's size. The number itself targets a single hall-wide
// size (BOOTH_NUMBER_TARGET_FS, "12" per the standard reference floor
// plans) so every booth's number reads at a glance the same size, matching
// how printed floor plans are laid out — but a real hall's smallest booths
// (as little as ~15px wide at this coordinate system's base scale) are
// physically too narrow to hold even a 3-4 digit number at 12px, so
// fitUniformBoothNumberSize caps the WHOLE HALL down to whatever the
// tightest booth can actually hold, the same size everywhere rather than
// per-booth, and never above the 12px target.
// Deliberately padded above the raw average-glyph-width/line-height a font
// metrics table would give you — real html2canvas/PDF-export rendering
// consistently ran a bit wider/taller than these predicted, so text that
// "just fit" the math was actually touching or crossing the box's bottom
// border on the real export (see the user's follow-up screenshot,
// 2026-07-31). Erring conservative here costs a slightly smaller font in
// the common case in exchange for the name never visibly overflowing.
const CHAR_W_RATIO = 0.65;
const LINE_H_RATIO = 1.3;

// Trimmed 12 -> 10 -> 8 (another 20%) per the user's explicit feedback
// (2026-07-31) — leaves more of each booth box's height for the exhibitor
// name below it.
export const BOOTH_NUMBER_TARGET_FS = 8;
const BOOTH_NUMBER_MIN_FS = 4;

// One fixed booth-number size for the whole hall, capped at the target size
// but never smaller than it needs to be to fit the SMALLEST booth's own
// number (not the name — the name has its own separate fit). Only the
// number's own digit count and the booth's own box size matter here.
export function fitUniformBoothNumberSize(booths) {
  if (!booths || booths.length === 0) return BOOTH_NUMBER_TARGET_FS;
  let smallest = BOOTH_NUMBER_TARGET_FS;
  for (const b of booths) {
    const numLen = Math.max(1, String(b.boothNo || '').length);
    const fit = Math.min(
      BOOTH_NUMBER_TARGET_FS,
      (b.boxW - 4) / (CHAR_W_RATIO * numLen),
      b.boxH * 0.65
    );
    if (fit < smallest) smallest = fit;
  }
  return Math.max(BOOTH_NUMBER_MIN_FS, smallest);
}

// Largest font size at which `name`, wrapped across as many lines as
// needed, fits within availW x availH — down to a 1px practical floor.
//
// Per the user's explicit correction (2026-07-31, with a reference mockup):
// the exhibitor name must always show IN FULL, never truncated with "…" —
// this is an audit requirement (the full company name has to be legible on
// the hi-res zoomable PDF export, even if it reads as a near-illegible dot
// on a normal-zoom screen view). So the floor here is pushed down far below
// "comfortably readable" — the name always wins the fit by shrinking
// further and wrapping across more lines, never by losing characters. Taken
// down from 2px to 1px in the same pass that made CHAR_W_RATIO/LINE_H_RATIO
// more conservative (to stop text touching the box's bottom border) — that
// tightening alone would have pushed some previously-fitting names into
// truncation, which is the one thing the user said must never happen;
// dropping the floor further keeps "always fits" true without giving back
// the overflow fix. truncateBoothName is kept as a last-resort safety net
// for the pathological case where even the 1px floor can't fit the name in
// the number of lines the box's own height allows (extremely long name in
// an extremely tiny booth) — real-world booths essentially never hit it.
export function fitBoothName(name, availW, availH) {
  if (!name) return 0;
  const maxFs = 8;
  const minFs = 1;
  for (let fs = maxFs; fs >= minFs; fs -= 0.25) {
    const colsPerLine = Math.max(1, Math.floor((availW - 2) / (fs * CHAR_W_RATIO)));
    const lines = Math.ceil(name.length / colsPerLine);
    if (lines * fs * LINE_H_RATIO <= availH) return fs;
  }
  return availH >= minFs * LINE_H_RATIO ? minFs : 0;
}

// Last-resort companion to fitBoothName for the rare case a name still
// doesn't fit even at the 2px floor — cuts `name` down (with a trailing
// "…") to whatever that font size can actually display, so the rendered
// text always terminates cleanly inside the box instead of relying on the
// booth's overflow:hidden to crop it mid-line. Call with the exact fs
// fitBoothName returned for the same availW/availH.
export function truncateBoothName(name, fs, availW, availH) {
  if (!name || !fs) return '';
  const colsPerLine = Math.max(1, Math.floor((availW - 2) / (fs * CHAR_W_RATIO)));
  const maxLines = Math.max(1, Math.floor(availH / (fs * LINE_H_RATIO)));
  const maxChars = colsPerLine * maxLines;
  if (name.length <= maxChars) return name;
  return `${name.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
