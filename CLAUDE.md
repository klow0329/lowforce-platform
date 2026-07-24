# LowForce Platform — Standing Rules

This file lists durable architectural and product decisions for LowForce (Event/Exhibition Management CRM, built for One International Group / ExpoCO Sdn Bhd, replacing an Excel-based workbook). These rules override default behavior and must be followed in every session. **Re-read this file at the start of every session.** Whenever a new standing decision is confirmed with the user, add it here immediately.

## 1. Multi-tenancy — from day one, no exceptions
- Every table carries `company_id`. Event-scoped tables also carry `event_id`.
- No cross-company data visibility, ever. Every query must filter by `company_id` (via `req.companyId` or equivalent).
- This is not optional per-feature — new tables and new endpoints must follow this pattern without being asked.

## 2. Everything company-configurable, nothing hardcoded
Price lists, sales stages/pipeline, user roles & permissions, AR aging buckets, segment/agent lists, and billing structure are all editable data owned by each company — not fixed in code.
- One International's current setup (its price list, stages, roles, aging buckets, segments, agents) is just the **default seed data for a new company**, not a hardcoded constant.
- When building a new feature, ask "would a second company need to configure this differently?" — if yes, it belongs in a per-company DB table with an admin UI, not in code.

## 3. Backend: Node.js
Same language as the React frontend. Do not introduce a second backend language/runtime.

## 4. Authentication: custom-built
Hashed passwords + server-side sessions. No third-party auth vendor (no Auth0, Clerk, Firebase Auth, etc.) — avoids per-user vendor fees.

## 5. Floor plan: SVG/vector-based (Phase 3 direction)
Clickable polygon booths carrying live price/status/exhibitor data — matching how ExpoFP/Map D actually build this. (Note: the floor plan currently implemented uses a raster hall image + pixel-coordinate booth grid, not true SVG polygons — see the Phase 1 completion check for current status. This rule states the target direction for that module going forward, not a claim that it's already built this way.)

## 6. Mobile/tablet responsiveness — every screen, including already-built ones
Every screen must work well on phone and tablet, not just desktop: readable text, tappable buttons, no sideways-scrolling tables. This applies retroactively — a screen built before this rule was stated is still expected to comply.
- **Mechanism**: `frontend/src/index.css` has a `@media (max-width: 700px)` block that reflows `<table class="responsive">` into stacked cards, using each `<td data-label="...">`'s `data-label` as the printed field name. A table only gets this behavior if it has **both** `className="responsive"` **and** `data-label` on every `<td>`.
- The shared `frontend/src/components/DataTable.jsx` component applies both automatically — any screen using `<DataTable>` gets mobile support for free.
- Any screen with hand-rolled `<table>` markup (not using `<DataTable>`) must add `className="responsive"` and `data-label={...}` on every `<td>` itself, or use a non-table layout that already reflows (cards/flex/grid).
- Before calling a new screen done, check it at a 375px viewport width.

## 7. Excel export
Available on list/report screens where it helps the team — at minimum: Customer Aging, Sales Report/Dashboard, Exhibitor list, Opportunity list — in addition to the existing Sales Order/Invoice export used for accounting.
- Implementation: `frontend/src/utils/exportExcel.js`, wired generically into `<DataTable>` via `exportFilename`/`exportSheetName` props → "Export to Excel" button.

## 8. PDF export
Available for real printable/sendable documents: Contract Form, Proforma, Invoice, and Official Receipt.
- Implementation: `frontend/src/utils/pdf.js`'s `downloadPdf(elementId, filename)` (html2pdf.js), used on each document's dedicated `*Print.jsx` page.

---

*This file is maintained by Claude across sessions per the user's instruction. Update it the moment a new standing rule or reversal is confirmed in conversation — don't wait to be asked twice.*
