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

async function extractBoothCandidates(pdfPath) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync('pdftotext', ['-bbox', pdfPath, '-']));
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('Booth auto-detection requires poppler-utils (pdftotext) to be installed on the server.');
    }
    throw err;
  }

  const pageMatch = stdout.match(/<page width="([\d.]+)" height="([\d.]+)"/);
  if (!pageMatch) throw new Error('Could not read page dimensions from the PDF.');
  const pageWidth = Number(pageMatch[1]);
  const pageHeight = Number(pageMatch[2]);
  const headerCutoff = pageHeight * HEADER_FRACTION;

  const words = [];
  const wordRe = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g;
  let m;
  while ((m = wordRe.exec(stdout))) {
    const [, xMin, yMin, xMax, yMax, text] = m;
    if (!BOOTH_NUMBER_RE.test(text)) continue;
    if (Number(yMin) < headerCutoff) continue;
    words.push({
      text, xMin: Number(xMin), yMin: Number(yMin), xMax: Number(xMax), yMax: Number(yMax),
    });
  }

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
