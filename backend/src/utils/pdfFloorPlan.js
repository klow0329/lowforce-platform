// Converts an uploaded hall floor plan PDF into (a) a background PNG for
// display and (b) a rough first pass at the booth list, by reading the
// PDF's own text layer rather than trying to OCR/vision-parse the drawing.
// These exports are Illustrator-generated architectural drawings with real,
// positioned text — pdftotext's -bbox mode gives every word's exact (x,y)
// in PDF points, which is far more reliable than image recognition for
// picking out the booth numbers stamped on the plan.
//
// Requires poppler-utils (pdftoppm, pdftotext) on PATH. On Windows this repo
// was developed against a manual winget install (oschwartz10612.Poppler);
// in production (Linux) install the `poppler-utils` package. Neither ships
// as an npm dependency because both are native binaries, not JS.
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const fs = require('fs');
const path = require('path');

async function pdfToPng(pdfPath, outputBasePath, dpi = 150) {
  try {
    await execFileAsync('pdftoppm', ['-png', '-r', String(dpi), '-singlefile', pdfPath, outputBasePath]);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('PDF conversion requires poppler-utils (pdftoppm) to be installed on the server.');
    }
    throw err;
  }
  return `${outputBasePath}.png`;
}

// Booth numbers on these plans are 3-5 digit integers (e.g. 1001, 1211,
// 2020) stamped inside the booth's floor area, always below the drawing's
// title/header block. Filtering out the top 15% of the page skips the
// header (which often includes the event year — a common false-positive
// digit run) without needing per-hall tuning.
const BOOTH_NUMBER_RE = /^\d{3,5}$/;
const HEADER_FRACTION = 0.15;

// Greedily chains digit-only words rightward into runs when the next word
// sits on the same baseline (vertical centres within 40% of glyph height)
// and the horizontal gap to it is small enough to be inter-character
// spacing rather than a gap between two unrelated labels (< 35% of glyph
// height — tighter than mere word-adjacency, since two real adjacent booth
// numbers like "3003"/"3004" sit further apart than that). Returns one
// merged {text, xMin, yMin, xMax, yMax} per run.
function mergeDigitRuns(digitWords) {
  const sorted = [...digitWords].sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin);
  const used = new Array(sorted.length).fill(false);
  const runs = [];

  for (let i = 0; i < sorted.length; i++) {
    if (used[i]) continue;
    const run = [sorted[i]];
    used[i] = true;
    let extended = true;
    while (extended) {
      extended = false;
      const last = run[run.length - 1];
      const lastHeight = last.yMax - last.yMin;
      const lastCenterY = (last.yMin + last.yMax) / 2;
      let bestIdx = -1;
      let bestGap = Infinity;
      for (let j = 0; j < sorted.length; j++) {
        if (used[j]) continue;
        const w = sorted[j];
        const height = w.yMax - w.yMin;
        const centerY = (w.yMin + w.yMax) / 2;
        const sameLine = Math.abs(centerY - lastCenterY) < Math.max(lastHeight, height) * 0.4;
        const gap = w.xMin - last.xMax;
        if (sameLine && gap > -Math.max(lastHeight, height) * 0.3 && gap < Math.max(lastHeight, height) * 0.35 && gap < bestGap) {
          bestIdx = j;
          bestGap = gap;
        }
      }
      if (bestIdx !== -1) {
        run.push(sorted[bestIdx]);
        used[bestIdx] = true;
        extended = true;
      }
    }
    if (run.length > 1) runs.push(run);
  }

  return runs.map((run) => ({
    text: run.map((w) => w.text).join(''),
    xMin: Math.min(...run.map((w) => w.xMin)),
    xMax: Math.max(...run.map((w) => w.xMax)),
    yMin: Math.min(...run.map((w) => w.yMin)),
    yMax: Math.max(...run.map((w) => w.yMax)),
  }));
}

async function extractBoothCandidates(pdfPath) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync('pdftotext', ['-bbox', pdfPath, '-']));
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('Booth auto-detection requires poppler-utils (pdftotext) to be installed on the server.');
    }
    // A DIFFERENT pdftotext (e.g. the Xpdf build bundled with Git for
    // Windows) can shadow poppler's on PATH — it doesn't understand -bbox
    // and just prints its own usage text, which would otherwise surface to
    // the user as an unreadable wall of CLI help. Distinguish that case
    // explicitly rather than throwing the raw stderr.
    if (err.stderr && /www\.xpdfreader\.com/i.test(err.stderr)) {
      throw new Error(
        'Booth auto-detection found the wrong pdftotext on PATH (Xpdf, not Poppler) — it doesn\'t support -bbox. '
        + 'Check that the Poppler install directory comes before any other pdftotext (e.g. Git for Windows\' mingw64\\bin) on the server\'s PATH.'
      );
    }
    throw err;
  }

  const pageMatch = stdout.match(/<page width="([\d.]+)" height="([\d.]+)"/);
  if (!pageMatch) throw new Error('Could not read page dimensions from the PDF.');
  const pageWidth = Number(pageMatch[1]);
  const pageHeight = Number(pageMatch[2]);
  const headerCutoff = pageHeight * HEADER_FRACTION;

  // Some Illustrator PDF exports (seen on real MIFB hall plans) don't store
  // a booth number as one contiguous <word> — the exporter's kerning/
  // tracking on that particular text run makes poppler's own word-breaking
  // heuristic split it into separate single/double-digit words instead
  // (e.g. "3011" export as "3" + "0" + "1" + "1" at near-zero gaps). Below
  // the header, every digit-only word below the header is a candidate for
  // this: pass 1 takes whichever words are already whole valid booth
  // numbers as-is (the common case); pass 2 tries to recover the rest by
  // re-joining runs of leftover digit-only words that sit on the same text
  // baseline with tight, character-like (not word-like) gaps between them.
  const allWords = [];
  const wordRe = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g;
  let m;
  while ((m = wordRe.exec(stdout))) {
    const [, xMin, yMin, xMax, yMax, text] = m;
    if (Number(yMin) < headerCutoff) continue;
    allWords.push({ text, xMin: Number(xMin), yMin: Number(yMin), xMax: Number(xMax), yMax: Number(yMax) });
  }

  const words = allWords.filter((w) => BOOTH_NUMBER_RE.test(w.text));

  const consumed = new Set(words);
  const leftoverDigits = allWords.filter((w) => !consumed.has(w) && /^\d+$/.test(w.text));
  words.push(...mergeDigitRuns(leftoverDigits).filter((w) => BOOTH_NUMBER_RE.test(w.text)));

  if (words.length === 0) return { pageWidth, pageHeight, booths: [] };

  // Default cell size: median nearest-neighbour horizontal gap between
  // label centres, used so every auto-created booth starts at a sane size
  // rather than a zero-width sliver — Operations resizes individual rows
  // afterward for anything irregular (merged blocks, corners, etc).
  const centersX = words.map((w) => (w.xMin + w.xMax) / 2).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < centersX.length; i++) {
    const gap = centersX[i] - centersX[i - 1];
    if (gap > 1) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  const medianGapX = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : (pageWidth / 40);
  const cellWidthPct = (Math.min(medianGapX, pageWidth / 20) / pageWidth) * 100;
  const cellHeightPct = cellWidthPct * (pageWidth / pageHeight); // keep it roughly square on screen

  const booths = words.map((w) => {
    const centerX = (w.xMin + w.xMax) / 2;
    const topY = w.yMin;
    return {
      booth_no: w.text,
      x_pct: Math.max(0, (centerX / pageWidth) * 100 - cellWidthPct / 2),
      y_pct: (topY / pageHeight) * 100,
      width_pct: cellWidthPct,
      height_pct: cellHeightPct,
    };
  });

  return { pageWidth, pageHeight, booths };
}

module.exports = { pdfToPng, extractBoothCandidates };
