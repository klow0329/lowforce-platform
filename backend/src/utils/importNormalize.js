// Shared cleanup for every bulk Excel/CSV import (Exhibitors, Agents, Users,
// Expense Codes, Segments) so uploaded data lands in the same shape as
// manually-entered records, regardless of stray spaces/casing/formatting in
// the source spreadsheet.
function cleanText(v) {
  return (v ?? '').toString().trim().toUpperCase();
}

// Emails/URLs are conventionally lowercase and would look wrong shouted in
// caps — trimmed only for whitespace, case left alone (lookups elsewhere
// already compare case-insensitively via LOWER()).
function cleanLower(v) {
  return (v ?? '').toString().trim().toLowerCase();
}

function cleanKeepCase(v) {
  return (v ?? '').toString().trim();
}

// Phone/contact numbers: digits only, no +, spaces, dashes, or brackets —
// matches the manual Exhibitor form's setDigitsOnly (see ExhibitorDetail.jsx)
// so a WhatsApp click-to-chat link (wa.me/<number>) works on an imported
// contact exactly as it does on a manually-entered one. NOT applied to
// registration/tax ID numbers (Reg No/TIN No/SST No), which legitimately
// carry letters and dashes as part of their real-world format.
function cleanDigits(v) {
  return (v ?? '').toString().replace(/\D/g, '');
}

module.exports = { cleanText, cleanLower, cleanKeepCase, cleanDigits };
