# LowForce Platform — Phase 1 Scaffold

This is the starting scaffold for the LowForce Event/Exhibition Management Platform, built to replace `MIFB26_SALES_RECORD.xlsm`.

**This scaffold was generated in a Claude.ai chat session as a starting point.** The real, ongoing build should now continue in **Claude Code** (desktop app or terminal) — that's the right tool for a growing, multi-week codebase with proper file history and testing. This chat sandbox does not persist between sessions.

## What's here

```
lowforce-platform/
├── backend/              Node.js + Express API
│   ├── src/
│   │   ├── config/db.js         PostgreSQL connection
│   │   ├── middleware/          auth + multi-tenant scoping
│   │   ├── routes/              API endpoints
│   │   ├── controllers/         request handlers
│   │   └── utils/                password hashing
│   ├── package.json
│   └── .env.example
├── database/
│   ├── schema.sql        Full Phase 1 table structure (multi-tenant, company-configurable)
│   └── seed.sql          Sample company + default stages/aging buckets to get started
├── frontend/              React (Vite) app
│   └── src/
│       ├── api/client.js
│       └── pages/
└── README.md              (this file)
```

## Architecture decisions already baked into this scaffold

Per `LowForce_Platform_Plan_v2.md`:

1. **Multi-tenant from the ground up** — every table carries `company_id`; event-scoped tables also carry `event_id`. No cross-company data visibility is possible even by accident, because every query is written to filter by `company_id` first.
2. **Nothing hardcoded that could differ by company** — sales stages (was fixed STG10/40/80/WON/LOSE), AR aging buckets (was fixed 30/60/90/120), segments, and agents are all rows in company-owned tables, not fixed code. A new reseller company gets sensible defaults (seeded from One International's current Excel setup) but can change every one of them without a developer touching code.
3. **Node.js backend**, matching the React frontend — one language across the stack.
4. **Custom-built authentication** — passwords hashed with bcrypt, session-based login, no third-party auth vendor and no per-user vendor fees.
5. **Exhibitor segments as a real child table**, not the old fixed 6-column hack from the Power Apps version — an exhibitor can have any number of segments.

## What actually works right now

- Full Phase 1 database schema (`database/schema.sql`) — covers Exhibitor Entry, Opportunity, Sales Orders, Invoices, Payments/Official Receipts — enough to derive Customer Aging and Sales Dashboard reports via queries.
- A working password-hashing + session-login pattern (`backend/src/utils/password.js`, `backend/src/middleware/auth.js`) — the actual security approach we confirmed, not a placeholder.
- A working example of multi-tenant scoping end-to-end: login → session carries `company_id` → every exhibitor query is automatically filtered to that company only (`backend/src/middleware/tenant.js` + `backend/src/controllers/exhibitors.controller.js`).
- A minimal React page that logs in and lists exhibitors, proving the frontend-to-backend connection works.

## What's NOT built yet (this is a scaffold, not Phase 1 complete)

Contract Form / Proforma / Invoice / Official Receipt / Customer Aging report / Sales Dashboard UI, data migration from the Excel workbook, and deployment — all of that is the actual Phase 1 work still ahead, to be done in Claude Code.

## Next steps (do these in Claude Code)

1. Open this folder in Claude Code: `cd lowforce-platform && claude`
2. Say: *"Here is my project scaffold and plan (attach `LowForceCRM_Checkpoint_v2_1.docx` and `LowForce_Platform_Plan_v2.md`). Set up a local PostgreSQL database, run `database/schema.sql` and `database/seed.sql`, install backend and frontend dependencies, and get the login + exhibitor list flow running locally so we can confirm the foundation before building out the rest of Phase 1."*
3. From there, work through Phase 1 screen by screen: Exhibitor Entry (full detail form), Opportunity tracking, then the document generation (Contract/Proforma/Invoice/Receipt), then Customer Aging and the Sales Dashboard.
4. Once confirmed working locally, deploy to Railway or Render (see plan doc Section 2 for hosting choice) and begin migrating real data from `MIFB26_SALES_RECORD.xlsm`.
