// ============================================================================
// Migrates real data from MIFB26_SALES_RECORD.xlsm into the platform.
// Safe to re-run: exhibitors are matched by company name and updated;
// contracts are skipped if their legacy ORDER number was already imported.
//
// What maps where:
//   Exhibitor Master            -> exhibitors (+ segments via MAIN/SUBCATEGORY 1-6)
//   Segment List                -> segment_main / segment_sub
//   AGENT column                -> agents ("INDIVIDUAL" = no agent)
//   SALES PERSON column         -> users (SALES role, placeholder emails)
//   Salesperson tabs (rows with an ORDER no) ->
//       opportunities (stage=WON) + sales_orders + invoices (IN1-4) + payments (RE/AM1-4)
//
// Documented assumptions:
//   * sales_orders.total_myr = "TOTAL WITH SST (MYR)" — the with-SST figure,
//     because the Excel invoices sum to it. SST split-out is future work.
//   * USD invoice/payment amounts are converted to MYR using the row's RATE.
//   * A contract flagged for multiple events is assigned to the first flagged
//     one (MIFB > MYFT > MCE); flagged-none defaults to MIFB26. Both logged.
//   * Payment rows have no receipt numbers in Excel -> receipt_no stays NULL.
//
// Usage: node scripts/migrate-mifb26.js "<path-to-xlsm>"
// ============================================================================
require('dotenv').config();
const XLSX = require('xlsx');
const { pool } = require('../src/config/db');
const { hashPassword } = require('../src/utils/password');

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const TEMP_PASSWORD = 'lowforce123';

const COUNTRY_CODES = {
  AZERBAIJAN: 'AZ', BELARUS: 'BY', BULGARIA: 'BG', CHINA: 'CN', EGYPT: 'EG',
  FRANCE: 'FR', GREECE: 'GR', 'HONG KONG': 'HK', INDIA: 'IN', INDONESIA: 'ID',
  ITALY: 'IT', JAPAN: 'JP', JORDAN: 'JO', MALAYSIA: 'MY', MYANMAR: 'MM',
  'NEW ZEALAND': 'NZ', PAKISTAN: 'PK', POLAND: 'PL', SEYCHELLES: 'SC',
  SINGAPORE: 'SG', 'SOUTH AFRICA': 'ZA', 'SOUTH KOREA': 'KR', 'SRI LANKA': 'LK',
  TAIWAN: 'TW', THAILAND: 'TH', TUNISIA: 'TN', TURKIYE: 'TR', UKRAINE: 'UA',
  VENEZUELA: 'VE', VIETNAM: 'VN', 'UNITED STATES': 'US', 'UNITED KINGDOM': 'GB',
};

const SALESPERSON_EMAILS = {
  'JOANNE LEOW': 'joanne.leow@lowforce.test',
  'ANTHONY HONG': 'anthony.hong@lowforce.test',
  'EDMUND OOI': 'edmund.ooi@lowforce.test',
  'TRACY TEONG': 'tracy.teong@lowforce.test',
};

const stats = {
  exhibitorsInserted: 0, exhibitorsUpdated: 0, segmentsLinked: 0, segmentMisses: [],
  contractsInserted: 0, contractsSkipped: 0, invoicesInserted: 0, paymentsInserted: 0,
  exhibitorsCreatedFromTabs: [], unknownCountries: new Set(), multiEventRows: 0, noEventRows: 0,
};

const clean = (v) => (v == null ? '' : String(v).trim());
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(clean(v).replace(/,/g, '').replace(/^-$/, '0'));
  return Number.isFinite(n) ? n : 0;
};
// Real Excel date cells arrive as serial numbers (unambiguous). Text-typed
// dates are a mix of M/D/YY and D/M/YY — when one part exceeds 12 the format
// is provable; genuinely ambiguous ones default to M/D/YY (Excel's own
// rendering for this workbook's real date cells).
function parseDate(v) {
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const m = clean(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, a, b, y] = m.map(Number);
  if (a > 12 && b <= 12) [a, b] = [b, a]; // provably D/M/YY — swap to month-first
  if (a > 12) return null;                // both parts impossible as a month
  const year = y < 100 ? 2000 + y : y;
  return `${year}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
}

async function ensureCountry(client, rawName) {
  const name = clean(rawName).toUpperCase();
  if (!name) return null;
  const code = COUNTRY_CODES[name] || name; // unmapped: full name doubles as the code, flagged for review
  if (!COUNTRY_CODES[name]) stats.unknownCountries.add(name);
  await client.query(
    `INSERT INTO countries (code, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [code, name.charAt(0) + name.slice(1).toLowerCase()]
  );
  return code;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node scripts/migrate-mifb26.js "<path-to-xlsm>"');
    process.exit(1);
  }

  const wb = XLSX.readFile(filePath);
  // raw: true — numbers stay numbers and real dates stay serials, so amounts
  // and dates parse without locale ambiguity.
  const sheetRows = (name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // --- Reference: segments ------------------------------------------------
    const segMainIds = new Map(); // NAME -> id
    const segSubIds = new Map();  // MAIN||SUB -> id
    // Space-insensitive fallback: the Master sheet writes some category names
    // with different spacing than the Segment List ("COFFEE/TEA" vs "COFFEE/ TEA")
    const norm = (s) => s.replace(/\s+/g, '');
    const findMain = (main) =>
      segMainIds.get(main) || [...segMainIds.entries()].find(([k]) => norm(k) === norm(main))?.[1];
    const findSub = (main, sub) =>
      segSubIds.get(`${main}||${sub}`) ||
      [...segSubIds.entries()].find(([k]) => norm(k) === norm(`${main}||${sub}`))?.[1];
    for (const row of sheetRows('Segment List').slice(1)) {
      const main = clean(row[0]).toUpperCase();
      const sub = clean(row[1]).toUpperCase();
      if (!main) continue;
      if (!segMainIds.has(main)) {
        const r = await client.query(
          `INSERT INTO segment_main (company_id, code, name) VALUES ($1, $2, $2)
           ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [COMPANY_ID, main]
        );
        segMainIds.set(main, r.rows[0].id);
      }
      if (sub && !segSubIds.has(`${main}||${sub}`)) {
        const existing = await client.query(
          `SELECT id FROM segment_sub WHERE company_id = $1 AND segment_main_id = $2 AND code = $3`,
          [COMPANY_ID, segMainIds.get(main), sub]
        );
        const id = existing.rows[0]
          ? existing.rows[0].id
          : (await client.query(
              `INSERT INTO segment_sub (company_id, segment_main_id, code, name) VALUES ($1, $2, $3, $3) RETURNING id`,
              [COMPANY_ID, segMainIds.get(main), sub]
            )).rows[0].id;
        segSubIds.set(`${main}||${sub}`, id);
      }
    }

    // --- Reference: salesperson users + event grants ------------------------
    const salesUserIds = new Map(); // NAME -> user id
    const passwordHash = await hashPassword(TEMP_PASSWORD);
    const salesRole = await client.query(
      `SELECT id FROM roles WHERE company_id = $1 AND code = 'SALES'`, [COMPANY_ID]
    );
    for (const [name, email] of Object.entries(SALESPERSON_EMAILS)) {
      const r = await client.query(
        `INSERT INTO users (company_id, role_id, email, password_hash, full_name)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (company_id, email) DO UPDATE SET full_name = EXCLUDED.full_name
         RETURNING id`,
        [COMPANY_ID, salesRole.rows[0].id, email, passwordHash, name]
      );
      salesUserIds.set(name, r.rows[0].id);
      await client.query(
        `INSERT INTO user_event_access (user_id, event_id)
         SELECT $1, id FROM events WHERE company_id = $2
         ON CONFLICT DO NOTHING`,
        [r.rows[0].id, COMPANY_ID]
      );
    }

    // --- Reference: agents ---------------------------------------------------
    const agentIds = new Map();
    async function ensureAgent(rawName) {
      const name = clean(rawName).toUpperCase();
      if (!name || name === 'INDIVIDUAL') return null; // direct booking, no agent
      if (!agentIds.has(name)) {
        const existing = await client.query(
          `SELECT id FROM agents WHERE company_id = $1 AND UPPER(name) = $2`, [COMPANY_ID, name]
        );
        const id = existing.rows[0]
          ? existing.rows[0].id
          : (await client.query(
              `INSERT INTO agents (company_id, name) VALUES ($1, $2) RETURNING id`, [COMPANY_ID, name]
            )).rows[0].id;
        agentIds.set(name, id);
      }
      return agentIds.get(name);
    }

    // --- Events ---------------------------------------------------------------
    const eventsResult = await client.query(
      `SELECT id, code FROM events WHERE company_id = $1`, [COMPANY_ID]
    );
    const eventIds = new Map(eventsResult.rows.map((e) => [e.code, e.id]));

    // --- Exhibitor Master -----------------------------------------------------
    const exhibitorIds = new Map(); // UPPER(name) -> id
    const existingExhibitors = await client.query(
      `SELECT id, UPPER(company_name) AS key FROM exhibitors WHERE company_id = $1`, [COMPANY_ID]
    );
    for (const row of existingExhibitors.rows) exhibitorIds.set(row.key, row.id);

    for (const r of sheetRows('Exhibitor Master').slice(1)) {
      const name = clean(r[0]);
      if (!name) continue;
      const key = name.toUpperCase();

      const countryCode = await ensureCountry(client, r[8]);
      const agentId = await ensureAgent(r[13]);
      const salespersonId = salesUserIds.get(clean(r[14]).toUpperCase()) || null;

      const fields = [
        name, clean(r[2]) || null, countryCode, agentId, salespersonId,
        clean(r[3]) || null, clean(r[4]) || null, clean(r[5]) || null, clean(r[6]) || null,
        clean(r[9]) || null, clean(r[10]) || null, clean(r[11]) || null,
        clean(r[12]) || null, clean(r[24]) || null, clean(r[23]) === '1',
        clean(r[15]) || null, clean(r[16]) || null, clean(r[17]) || null, clean(r[18]) || null,
        clean(r[19]) || null, clean(r[20]) || null, clean(r[21]) || null, clean(r[22]) || null,
        clean(r[3]) || null, // billing_address mirrors company address (billing_same_as_company=TRUE)
      ];

      let exhibitorId;
      if (exhibitorIds.has(key)) {
        exhibitorId = exhibitorIds.get(key);
        await client.query(
          `UPDATE exhibitors SET
             company_name = $2, company_name_alt = $3, country_code = $4, agent_id = $5, salesperson_id = $6,
             address = $7, postcode = $8, city = $9, state = $10,
             reg_no = $11, tin_no = $12, sst_no = $13, website = $14, fax = $15, halal_certified = $16,
             contact1_name = $17, contact1_job_title = $18, contact1_phone = $19, contact1_email = $20,
             contact2_name = $21, contact2_job_title = $22, contact2_phone = $23, contact2_email = $24,
             billing_address = $25
           WHERE id = $1`,
          [exhibitorId, ...fields]
        );
        stats.exhibitorsUpdated++;
      } else {
        const ins = await client.query(
          `INSERT INTO exhibitors (
             company_id, company_name, company_name_alt, country_code, agent_id, salesperson_id,
             address, postcode, city, state, reg_no, tin_no, sst_no, website, fax, halal_certified,
             contact1_name, contact1_job_title, contact1_phone, contact1_email,
             contact2_name, contact2_job_title, contact2_phone, contact2_email, billing_address
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
           RETURNING id`,
          [COMPANY_ID, ...fields]
        );
        exhibitorId = ins.rows[0].id;
        exhibitorIds.set(key, exhibitorId);
        stats.exhibitorsInserted++;
      }

      // Segments 1-6 -> real child rows (main required, sub + remarks optional)
      await client.query(`DELETE FROM exhibitor_segments WHERE exhibitor_id = $1`, [exhibitorId]);
      for (let s = 0; s < 6; s++) {
        const main = clean(r[25 + s * 3]).toUpperCase();
        const sub = clean(r[26 + s * 3]).toUpperCase();
        const remarks = clean(r[27 + s * 3]) || null;
        if (!main) continue;
        const mainId = findMain(main);
        if (!mainId) {
          stats.segmentMisses.push(`${name}: ${main}`);
          continue;
        }
        const subId = sub ? findSub(main, sub) : null;
        if (sub && !subId) {
          stats.segmentMisses.push(`${name}: ${main} / ${sub}`);
        }
        await client.query(
          `INSERT INTO exhibitor_segments (exhibitor_id, segment_main_id, segment_sub_id, remarks)
           VALUES ($1, $2, $3, $4)`,
          [exhibitorId, mainId, subId || null, remarks]
        );
        stats.segmentsLinked++;
      }

      // Event participation from the Master's MIFB / MYFT / MCE flags
      await client.query(`DELETE FROM exhibitor_events WHERE exhibitor_id = $1`, [exhibitorId]);
      const participationFlags = [['MIFB26', r[47]], ['MYFT26', r[48]], ['MCE26', r[49]]];
      for (const [code, flag] of participationFlags) {
        if (num(flag) > 0 || clean(flag) === '1') {
          const evId = eventIds.get(code);
          if (evId) {
            await client.query(
              `INSERT INTO exhibitor_events (exhibitor_id, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [exhibitorId, evId]
            );
            stats.participationLinked = (stats.participationLinked || 0) + 1;
          }
        }
      }
    }

    // --- WON stage for migrated contracts ------------------------------------
    const wonStage = await client.query(
      `SELECT id FROM sales_stages WHERE company_id = $1 AND is_won = TRUE LIMIT 1`, [COMPANY_ID]
    );
    const wonStageId = wonStage.rows[0].id;

    const alreadyImported = new Set(
      (await client.query(
        `SELECT legacy_order_no FROM sales_orders WHERE company_id = $1 AND legacy_order_no IS NOT NULL`,
        [COMPANY_ID]
      )).rows.map((r) => r.legacy_order_no)
    );

    // --- Salesperson tabs -> contracts + invoices + payments ------------------
    for (const tab of ['JOANNE LEOW', 'ANTHONY HONG', 'EDMUND OOI']) {
      const salespersonId = salesUserIds.get(tab);
      for (const r of sheetRows(tab).slice(3)) {
        const orderNo = clean(r[0]);
        const companyName = clean(r[4]);
        // Skip blanks and the repeated in-data header rows
        if (!orderNo || !companyName || !/^[A-Z]{2,3}\d+/.test(orderNo)) continue;

        if (alreadyImported.has(orderNo)) {
          stats.contractsSkipped++;
          continue;
        }

        // Which event? First flagged of MIFB > MYFT > MCE; none flagged -> MIFB26.
        const flags = [num(r[5]) > 0, num(r[6]) > 0, num(r[7]) > 0];
        const flagCount = flags.filter(Boolean).length;
        if (flagCount > 1) stats.multiEventRows++;
        if (flagCount === 0) stats.noEventRows++;
        const eventCode = flags[0] ? 'MIFB26' : flags[1] ? 'MYFT26' : flags[2] ? 'MCE26' : 'MIFB26';
        const eventId = eventIds.get(eventCode);

        // Exhibitor lookup — create a minimal record if not in the Master sheet
        let exhibitorId = exhibitorIds.get(companyName.toUpperCase());
        if (!exhibitorId) {
          const countryCode = await ensureCountry(client, r[9]);
          const ins = await client.query(
            `INSERT INTO exhibitors (company_id, company_name, country_code, salesperson_id)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [COMPANY_ID, companyName, countryCode, salespersonId]
          );
          exhibitorId = ins.rows[0].id;
          exhibitorIds.set(companyName.toUpperCase(), exhibitorId);
          stats.exhibitorsCreatedFromTabs.push(`${companyName} (${orderNo})`);
        }

        const agentId = await ensureAgent(r[3]);
        if (agentId) {
          await client.query(`UPDATE exhibitors SET agent_id = COALESCE(agent_id, $2) WHERE id = $1`, [exhibitorId, agentId]);
        }

        const contractDate = parseDate(r[2]);
        const boothSqm = num(r[16]) || null;
        const boothType = clean(r[15]) || null;
        const rate = num(r[51]) || 1;
        const totalWithSstMyr = num(r[53]);

        const opp = await client.query(
          `INSERT INTO opportunities (company_id, event_id, exhibitor_id, salesperson_id, stage_id, booth_sqm, booth_type, estimated_value_myr)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [COMPANY_ID, eventId, exhibitorId, salespersonId, wonStageId, boothSqm, boothType, totalWithSstMyr]
        );

        const so = await client.query(
          `INSERT INTO sales_orders (company_id, event_id, exhibitor_id, opportunity_id, salesperson_id,
                                     contract_type, contract_date, total_myr,
                                     legacy_order_no, booking_type, hall, booth_no, dimension)
           VALUES ($1, $2, $3, $4, $5, 'STANDARD', $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
          [COMPANY_ID, eventId, exhibitorId, opp.rows[0].id, salespersonId,
           contractDate, totalWithSstMyr, orderNo,
           clean(r[11]) || null, clean(r[12]) || null, clean(r[13]) || null, clean(r[14]) || null]
        );
        const salesOrderId = so.rows[0].id;
        stats.contractsInserted++;

        // Invoices IN1-4 (cols 54/57/60/63 = no, +1 date, +2 value)
        const invoiceIdsByPosition = [];
        for (const col of [54, 57, 60, 63]) {
          const invoiceNo = clean(r[col]);
          if (!invoiceNo) { invoiceIdsByPosition.push(null); continue; }
          const invoiceAmountMyr = num(r[col + 2]) * rate;
          const inv = await client.query(
            `INSERT INTO invoices (company_id, event_id, sales_order_id, exhibitor_id, invoice_no, invoice_date, amount_myr)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (company_id, invoice_no) DO NOTHING
             RETURNING id`,
            [COMPANY_ID, eventId, salesOrderId, exhibitorId, invoiceNo, parseDate(r[col + 1]), invoiceAmountMyr]
          );
          invoiceIdsByPosition.push(inv.rows[0]?.id || null);
          if (inv.rows[0]) stats.invoicesInserted++;
        }

        // Payments RE/AM 1-4 (cols 67/69/71/73 = date, +1 amount), paired to the
        // invoice at the same position; falls back to the first invoice.
        const firstInvoiceId = invoiceIdsByPosition.find((id) => id);
        for (let p = 0; p < 4; p++) {
          const dateCol = 67 + p * 2;
          const amountMyr = num(r[dateCol + 1]) * rate;
          if (amountMyr <= 0) continue;
          const invoiceId = invoiceIdsByPosition[p] || firstInvoiceId;
          if (!invoiceId) continue; // payment without any invoice — nothing to attach to
          await client.query(
            `INSERT INTO payments (invoice_id, payment_date, amount_myr, payment_method)
             VALUES ($1, $2, $3, 'Bank Transfer')`,
            [invoiceId, parseDate(r[dateCol]), amountMyr]
          );
          stats.paymentsInserted++;
        }
      }
    }

    await client.query('COMMIT');

    console.log('=== Migration complete ===');
    console.log(`Exhibitors: ${stats.exhibitorsInserted} inserted, ${stats.exhibitorsUpdated} updated`);
    console.log(`Segments linked: ${stats.segmentsLinked} (misses: ${stats.segmentMisses.length})`);
    console.log(`Event participation links: ${stats.participationLinked || 0}`);
    console.log(`Contracts: ${stats.contractsInserted} inserted, ${stats.contractsSkipped} already imported`);
    console.log(`Invoices: ${stats.invoicesInserted}, Payments: ${stats.paymentsInserted}`);
    console.log(`Event flags: ${stats.multiEventRows} multi-event rows (first flag used), ${stats.noEventRows} unflagged (defaulted to MIFB26)`);
    if (stats.exhibitorsCreatedFromTabs.length) {
      console.log(`Exhibitors created from contract tabs (not in Master): ${stats.exhibitorsCreatedFromTabs.length}`);
      stats.exhibitorsCreatedFromTabs.slice(0, 10).forEach((x) => console.log('  ' + x));
    }
    if (stats.unknownCountries.size) {
      console.log(`Countries without ISO mapping (stored with name as code): ${[...stats.unknownCountries].join(', ')}`);
    }
    if (stats.segmentMisses.length) {
      console.log('First few unmatched segment pairs:');
      stats.segmentMisses.slice(0, 5).forEach((x) => console.log('  ' + x));
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
