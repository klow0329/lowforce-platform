import html2pdf from 'html2pdf.js';

// Downloads a rendered document section as a real PDF file (A4 by default).
// Used by the Contract / Proforma / Invoice / Official Receipt pages — the
// Print button stays for paper, this produces the file to email to
// exhibitors. orientation: 'portrait' (default, matches every existing
// caller) or 'landscape' — the Floor Plan capture is wide, not tall.
// opts.scale raises the html2canvas raster resolution (default 2) — Floor
// Plan exports pass a higher value so the PDF stays crisp when zoomed in
// for audit purposes. opts.format/opts.margin let a caller use a bigger
// physical page (e.g. 'a1') instead of A4, so a wide hall map isn't
// squeezed down and losing detail.
//
// opts.longEdge (mm): instead of a fixed opts.format, size the page to
// exactly match the CAPTURED CONTENT's own aspect ratio, with its longer
// side set to this length — the page then has zero dead space and the
// image fills it edge to edge. Deliberately computed from the actual
// html2canvas output (this.prop.canvas.width/height) rather than the
// source DOM element's offsetWidth/offsetHeight beforehand — measuring the
// DOM ahead of time is timing-sensitive (can read 0 before layout/paint has
// caught up) and silently falls back to a generic page shape unrelated to
// the real content, which is what was leaving the map stranded in a
// corner of an oversized, wrongly-shaped page.
export function downloadPdf(elementId, filename, orientation = 'portrait', opts = {}) {
  const element = document.getElementById(elementId);
  if (!element) return;
  const { scale = 2, format = 'a4', margin = 12, longEdge } = opts;
  const worker = html2pdf()
    .set({
      margin: Array.isArray(margin) ? margin : [margin, margin, margin, margin],
      filename: `${filename}.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale, useCORS: true },
      jsPDF: { unit: 'mm', format, orientation },
    })
    .from(element);

  if (!longEdge) {
    return worker.save();
  }

  return worker
    .toCanvas()
    .then(function fitPageToCanvas() {
      const canvas = this.prop.canvas;
      const aspect = canvas && canvas.height > 0 ? canvas.width / canvas.height : 1;
      const pageSize = aspect >= 1 ? [longEdge, longEdge / aspect] : [longEdge * aspect, longEdge];
      return this.set({ jsPDF: { unit: 'mm', format: pageSize, orientation } });
    })
    .toPdf()
    .save();
}
