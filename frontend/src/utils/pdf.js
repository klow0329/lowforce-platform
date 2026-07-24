import html2pdf from 'html2pdf.js';

// Downloads a rendered document section as a real PDF file (A4). Used by
// the Contract / Proforma / Invoice / Official Receipt pages — the Print
// button stays for paper, this produces the file to email to exhibitors.
// orientation: 'portrait' (default, matches every existing caller) or
// 'landscape' — the Floor Plan presentation capture is wide, not tall.
export function downloadPdf(elementId, filename, orientation = 'portrait') {
  const element = document.getElementById(elementId);
  if (!element) return;
  return html2pdf()
    .set({
      margin: [12, 12, 12, 12],
      filename: `${filename}.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation },
    })
    .from(element)
    .save();
}
