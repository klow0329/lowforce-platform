# LowForce — Shared Testing Environment

This machine hosts the testing instance of the LowForce platform. Everything
here (accounts, exhibitors, opportunities, money figures) is **temporary demo
data** and will be replaced before real use.

## Access

| Who | URL |
|---|---|
| On this PC | http://localhost:3001 |
| Other people on the same network | http://10.196.5.115:3001 *(this PC's Wi-Fi address — re-check with `ipconfig` if the router reassigns it)* |

For access from outside the network (a real shared domain), attach a domain +
HTTPS later — the app is already configured for it (`trust proxy`, secure
cookies under `NODE_ENV=production`); no code changes needed.

## Test accounts

Temporary password for **all** accounts: `lowforce123`

| Email | Name | Role |
|---|---|---|
| admin@lowforce.test | Test Admin | Admin |
| aisyah@lowforce.test | Aisyah Rahman | Sales |
| marcus@lowforce.test | Marcus Tan | Sales |
| priya@lowforce.test | Priya Nair | Sales |
| finance@lowforce.test | Test Finance | Finance |
| joanne.leow@lowforce.test | Joanne Leow | Sales (real MIFB26 data) |
| anthony.hong@lowforce.test | Anthony Hong | Sales (real MIFB26 data) |
| edmund.ooi@lowforce.test | Edmund Ooi | Sales (real MIFB26 data) |
| tracy.teong@lowforce.test | Tracy Teong | Sales |

(Plus the original `low@oneinternational.com.my` admin account. The four
real-staff accounts have placeholder `.test` emails — update them to real
addresses from the Admin screen when ready.)

## Real data

The database contains the migrated contents of `MIFB26_SALES_RECORD.xlsm` —
911 exhibitors, 497 contracts with their invoices and payments, and the real
segment/agent/country reference data. The fictional demo records (Golden
Harvest etc.) have been removed, so every number on the Dashboard and Aging
screens is real.

- Re-running the import is safe: `node scripts/migrate-mifb26.js
  "<path-to-xlsm>"` in `backend/` skips anything already imported (matched by
  the Excel ORDER number).
- Do **not** re-run `scripts/seed-test-data.js` — that's the old demo seed
  and would re-add fictional exhibitors and opportunities on top of the real
  data. The named test *user accounts* it created are still active and fine
  to use.

Every user can change their own password: click your name in the top-right
corner. Admins can also add users, reset passwords, deactivate accounts,
manage events and per-user event access from the **Admin** page, and edit
each event's rates on the **Price List** page (everyone else sees it
read-only).

## Latest changes to test

- **Exhibitor form**: "Alt Name" (was Chinese name); fuller Billing block
  (postcode, city, country, Co. Reg/TIN/SST No., contact no. — auto-mirrored
  when "Same as company" is on); segments are now rows of Main Category +
  optional Subcategory + Remarks; **Event Participation** checkboxes show
  MIFB as the main event with MYFT/MCE as sub-events (add/remove freely).
- **Admin → Events**: an event can be marked as a sub-event of a main event.
- **Price List**: MEP (Marketing Exposure Package) is priced per rate tier;
  CUB (Customized Booth) added; every item can carry its own discount —
  flat MYR amount or percentage. Descriptions are editable per item.
- **Contracts**: Booking Type, Hall, Booth No, Dimension and Remarks fields;
  printable Contract/Proforma/Invoice show the fuller Bill To block
  (postcode/city, Reg/TIN/SST No., contact).
- **Opportunities**: Remarks field.

## MIFB27 — the fresh cycle

The **MIFB 2027** event exists with an empty pipeline (everything is
event-scoped, so MIFB26's records don't carry over) and a price list copied
from the real MIFB26 rates — adjust it on the Price List page with MIFB 2027
selected in the event switcher.

## Starting the environment

Double-click **`start-lowforce.cmd`** in this folder. It starts PostgreSQL if
needed, then the app server. Keep the window open while people are using the
app. Logins survive server restarts (sessions are stored in the database).

## Notes / known limitations of this test setup

- **Windows Firewall**: the first time someone else tries to connect, Windows
  may silently block it. If LAN access doesn't work, allow Node.js through the
  firewall: Settings → Windows Security → Firewall → "Allow an app through
  firewall" → tick both boxes for Node.js (needs admin).
- **The PC must stay on** and `start-lowforce.cmd` running for others to use it.
- **HTTP only** — fine on a trusted LAN for testing; do not expose this
  directly to the internet without HTTPS.
- After changing frontend code, rebuild it (`npm run build` in `frontend/`)
  for the change to appear at :3001. (The Vite dev server at :5173 still works
  for development as before.)
- Re-seeding: `node scripts/seed-test-data.js` in `backend/` is safe to
  re-run; it skips anything that already exists.
