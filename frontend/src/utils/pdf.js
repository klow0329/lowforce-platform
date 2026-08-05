import html2pdf from 'html2pdf.js';
import { PDFDocument } from 'pdf-lib';

// Builds a download filename from parts (e.g. "INV-2026-0008", "MIFB27",
// "ACME EXHIBITIONS SDN BHD" -> "INV-2026-0008-MIFB27-ACME EXHIBITIONS SDN
// BHD"), used by Contract/Invoice/Proposal/Receipt so the file is
// identifiable without opening it. Drops characters that are invalid (or
// awkward) in a filename on Windows — the platform every user of this app
// so far has been on — and skips any blank/undefined part rather than
// leaving a stray "--" where an event code or company name isn't known yet.
export function buildPdfFilename(...parts) {
  return parts
    .filter(Boolean)
    .map((p) => String(p).replace(/[\\/:*?"<>|]/g, '').trim())
    .filter(Boolean)
    .join('-');
}

// Downloads a rendered document section as a real PDF file (A4 by default).
// Used by the Contract / Proforma / Invoice / Official Receipt pages — the
// Print button stays for paper, this produces the file to email to
// exhibitors. orientation: 'portrait' (default, matches every existing
// caller) or 'landscape' — the Floor Plan capture is wide, not tall.
// opts.scale raises the html2canvas raster resolution (default 2) — Floor
// Plan exports pass a higher value so the PDF stays crisp when zoomed in
// for audit purposes. opts.format/opts.margin let a caller use a bigger
// physical page (e.g. 'a1', or a custom [width, height] mm array sized to
// match the captured content's own aspect ratio) instead of A4, so a wide
// hall map isn't squeezed down and losing detail.
//
// format must be computed by the CALLER, upfront, from state it already
// reliably knows about its own capture target — not derived here from the
// html2canvas output after the fact. html2pdf's worker chain caches a
// pageSize the first time ANY step needs it (toContainer(), triggered
// internally by the first toCanvas() call) using whatever jsPDF options
// were set at that point, and sizes the actual html2canvas capture
// container's CSS width from that cached value; recomputing pageSize
// afterwards via a later .set({jsPDF...}) does update it for the final PDF
// page, but the capture container was already laid out (and captured)
// against the earlier, wrong size — silently rendering the real content
// small inside an unrelated page shape. Passing the correct format in this
// single .set() call, before anything else runs, avoids that ordering bug
// entirely.
// opts.appendPdfUrl: fetch this PDF (same-origin, session-cookie
// authenticated) and append its pages onto the end of the generated
// document — used for auto-imprinting the company's own uploaded Terms &
// Conditions PDF onto a Contract export without the user re-attaching it
// each time. When set, the generated PDF is built as raw bytes and merged
// with pdf-lib rather than saved directly by html2pdf, since html2pdf/jsPDF
// has no notion of appending an existing PDF document's own pages (only
// embedding raster images).
export function downloadPdf(elementId, filename, orientation = 'portrait', opts = {}) {
  const element = document.getElementById(elementId);
  if (!element) return;
  const { scale = 2, format = 'a4', margin = 12, appendPdfUrl, width, height } = opts;
  // width/height (in CSS px, the element's own known content box — e.g. the
  // Floor Plan map's imgSize/imgHeightPx at zoom=1): html2canvas, given no
  // explicit width/height, measures the element via its own DOM-cloning
  // logic rather than a plain getBoundingClientRect, which can pick up
  // extra width from a scrollable ANCESTOR (overflow: auto, as the Floor
  // Plan viewport is) instead of stopping at the target element's own box —
  // observed directly on a real export: the map's on-screen box measured
  // 905x640 CSS px, but the embedded raster came out 25432x5152 (a ~3.5x-
  // too-wide capture, aspect 4.9 instead of the intended 1.4), which is
  // exactly what put the correctly-shaped image on a page sized for the
  // narrower/wrong aspect — visually just a small block in the top-left of
  // an otherwise blank page. windowWidth/windowHeight pin html2canvas's own
  // internal rendering viewport to the caller-supplied size so it can't
  // "see" past the real content no matter what ancestor it's scrolled/
  // nested inside; width/height crop the resulting capture to match.
  const html2canvasOpts = { scale, useCORS: true };
  if (width) { html2canvasOpts.width = width; html2canvasOpts.windowWidth = width; }
  if (height) { html2canvasOpts.height = height; html2canvasOpts.windowHeight = height; }
  const worker = html2pdf()
    .set({
      margin: Array.isArray(margin) ? margin : [margin, margin, margin, margin],
      filename: `${filename}.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: html2canvasOpts,
      jsPDF: { unit: 'mm', format, orientation },
    })
    .from(element);

  if (!appendPdfUrl) {
    return worker.save();
  }
  return appendAndSave(worker, appendPdfUrl, filename);
}

async function appendAndSave(worker, appendPdfUrl, filename) {
  const bodyBytes = await worker.output('arraybuffer');
  const bodyDoc = await PDFDocument.load(bodyBytes);

  try {
    const res = await fetch(appendPdfUrl, { credentials: 'include' });
    if (res.ok) {
      const termsBytes = await res.arrayBuffer();
      const termsDoc = await PDFDocument.load(termsBytes);
      const copiedPages = await bodyDoc.copyPages(termsDoc, termsDoc.getPageIndices());
      copiedPages.forEach((page) => bodyDoc.addPage(page));
    }
  } catch {
    // The main document still downloads on its own below even if the
    // terms PDF can't be fetched/parsed — a broken upload shouldn't block
    // the contract itself from exporting.
  }

  const mergedBytes = await bodyDoc.save();
  const blob = new Blob([mergedBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
