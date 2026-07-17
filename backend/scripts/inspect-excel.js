// Dumps the structure of the Excel CRM workbook so the migration mapping can
// be designed against what's actually in the file, not assumptions.
// Usage: node scripts/inspect-excel.js "<path-to-xlsm>" [sheetName]
const XLSX = require('xlsx');

const [, , filePath, onlySheet] = process.argv;
const wb = XLSX.readFile(filePath);

if (!onlySheet) {
  console.log('Sheets:');
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
    const rows = range ? range.e.r + 1 : 0;
    const cols = range ? range.e.c + 1 : 0;
    console.log(`  ${name.padEnd(24)} ${rows} rows x ${cols} cols`);
  }
} else {
  const sheet = wb.Sheets[onlySheet];
  if (!sheet) {
    console.error(`No sheet named "${onlySheet}"`);
    process.exit(1);
  }
  // Print the first 12 rows raw so headers (wherever they sit) are visible.
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  console.log(`Total rows: ${rows.length}`);
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    console.log(`row ${i}: ${JSON.stringify(rows[i].slice(0, 25))}`);
  }
}
