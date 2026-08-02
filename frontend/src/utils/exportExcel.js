import * as XLSX from 'xlsx';

// Guards against CSV/Excel formula injection: a cell value starting with
// =, +, -, or @ is executed as a formula by Excel/LibreOffice when the
// exported file is later opened — dangerous if it ever came from
// user-entered free text (company name, remarks, correspondence...).
// Prefixing with a straight quote is Excel's own "force text" escape, so
// the value still displays exactly as typed.
function neutralizeFormula(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@]/.test(v) ? `'${v}` : v;
}

function sanitizeRows(rows) {
  return rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k] = neutralizeFormula(v);
    return out;
  });
}

// Standing pattern: list/report screens get an "Export to Excel" button that
// dumps the currently displayed (already filtered) rows — same flexibility
// the team had with the Excel workbook.
// `rows` is an array of plain objects; keys become the header row.
export function exportToExcel(rows, filename, sheetName = 'Sheet1') {
  if (!rows || rows.length === 0) {
    window.alert('Nothing to export.');
    return;
  }
  const ws = XLSX.utils.json_to_sheet(sanitizeRows(rows));
  // Reasonable column widths from header + data lengths
  const headers = Object.keys(rows[0]);
  ws['!cols'] = headers.map((h) => ({
    wch: Math.min(
      40,
      Math.max(h.length, ...rows.slice(0, 200).map((r) => String(r[h] ?? '').length)) + 2
    ),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
