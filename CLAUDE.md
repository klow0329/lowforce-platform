# LowForce Platform — Standing Rules

This file lists durable architectural and product decisions for LowForce (Event/Exhibition Management CRM). **LowForce is a product the user intends to sell to other organizations, not a bespoke build for One International alone** — One International (ExpoCO Sdn Bhd) is the first customer and the source of the original Excel-workbook requirements, but every rule below is written for a multi-tenant SaaS product with unrelated companies on it, not a single-customer system. These rules override default behavior and must be followed in every session. **Re-read this file at the start of every session.** Whenever a new standing decision is confirmed with the user, add it here immediately.

**Also read `PROJECT_LOG.md` at the start of every session.** That file is a running, dated history of what was asked/built/left open each session — separate from this one, which only holds fixed standing rules. **After every session, append a short dated entry to `PROJECT_LOG.md`** summarizing: what was asked, what was decided or built, and anything still open or unresolved. This keeps continuity even if a session's own memory gets compacted.

## 1. Multi-tenancy — from day one, no exceptions
- Every table carries `company_id`. Event-scoped tables also carry `event_id`.
- No cross-company data visibility, ever. Every query must filter by `company_id` (via `req.companyId` or equivalent).
- This is not optional per-feature — new tables and new endpoints must follow this pattern without being asked.

## 2. Everything company-configurable, nothing hardcoded
Price lists, sales stages/pipeline, user roles & permissions, AR aging buckets, segment/agent lists, and billing structure are all editable data owned by each company — not fixed in code.
- One International's current setup (its price list, stages, roles, aging buckets, segments, agents) is just the **default seed data for a new company**, not a hardcoded constant.
- When building a new feature, ask "would a second company need to configure this differently?" — if yes, it belongs in a per-company DB table with an admin UI, not in code.
- **The user has explicitly confirmed (2026-07-31) this is a sell-to-other-organizations concern, not a hypothetical**: LowForce is meant to be sold beyond One International, so a second (or hundredth) customer with completely different requirements must be able to configure their own setup with zero code changes. "One International" (or any of its specific data — company name, group name, price list codes, stage names, etc.) must never appear in application logic (controllers, middleware, conditionals) — only ever as replaceable seed/example data, exactly like every other per-company table already works.

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

## 9. Group layer above Company — optional, foundational only (2026-07-31)
The platform supports an optional **Group** layer sitting above individual Companies, for future holding-company/multi-company consolidation — added ahead of more Phase 1 screens being built on top of the current structure so it never needs retrofitting later.
- `groups` table (`id`, `name`, `slug`, `created_at`); `companies.group_id` is a **nullable** FK to it — a company can stand alone or belong to a group, and every existing `company_id`-scoped query keeps working exactly as before. Migration: `database/migrations/068_groups.sql`.
- Seeded now: one group "One International Group" (slug `one-international-group`), with the real One International company linked to it — so the live setup already reflects Group → Company → Events → everything else. This is seed data only (see rule #2) — any future group-consuming logic must work for an arbitrary group/company set, not assume One International's names, IDs, or company count.
- `users.has_group_access` (boolean, default false) is the access-grant foundation: a user with this set is meant to see combined data across every company under their own company's group, in addition to their normal single-company access — derived via `company_id` → `group_id`, not a separate per-group grant. Regular (non-flagged) users are unaffected and keep seeing only their own company's data.
- **Not built yet, by design**: no consolidated/cross-company dashboard, no Admin UI for managing groups or granting `has_group_access`, and no middleware/query logic actually consuming the flag. This is schema + access-flag foundation only — build the consuming features when a real Phase 2+ need for them shows up, don't retrofit the schema again.

## 10. Platform-owner console — separate system, separate session, outside every tenant (2026-08-04)
Registering/suspending groups and companies is a LowForce-operator action, not a tenant Admin action — it's commercial (licensing/billing) and, since Group membership grants cross-company visibility (rule #9 + Group Resource Sharing), a privilege-escalation surface if any tenant could reach it.
- `platform_admins` is a **separate table**, never a flag on `users` — `users` is company-scoped, so a cross-tenant superuser living there would be a row some customer's own Admin could see, deactivate, or reassign. Migration `080_platform_admins.sql`.
- Gated by `req.session.platformAdmin`, a **different session key** from tenant auth's `req.session.user`. Neither key satisfies the other's middleware (`requirePlatformAdmin` vs `attachTenant`) — there is no flag to mis-check and no escalation path from inside a tenant. Login calls `session.regenerate()`, so a session can never hold both at once.
- Console at `/platform`, rendered outside the tenant app shell entirely (no NavBar/EventContext/CompanyProvider) — see the early-return in `frontend/src/App.jsx` before the tenant login gate.
- Registering a company also seeds its starter config (roles/stages/aging buckets/settings) — without at least the ADM role there'd be nothing to assign its first user. No delete endpoint — companies **suspend** (`companies.is_active` + `suspended_at`/`suspended_reason`, migration `081`), never delete, since `audit_log` correctly FK-references companies and a hard delete would break that trail. Suspension is enforced at both login and the live-session recheck in `me()` (`backend/src/controllers/auth.controller.js`) — this enforcement did not exist before 2026-08-04; `companies.is_active` had been written but never read anywhere.
- First admin is created by `backend/scripts/create-platform-admin.js <email> "<Name>"` — generates its own password and prints it once, never hardcoded/committed/passed as an argument. Prefers `DATABASE_PUBLIC_URL` over `DATABASE_URL` so it works under `railway run` against production (the injected `DATABASE_URL` on Railway points at an internal-only host).
- `platform_audit_log` (migration `081`) is a separate table from tenant `audit_log` (whose `company_id` is NOT NULL — platform actions often have none, e.g. creating a group) and is never visible to any tenant.

## 11. No routing/approval decision may be hardcoded to a role — always admin-configurable, always defaults safely (2026-08-04)
Every "who is allowed to do X" decision in the system must be driven by company-owned data (`approval_rules`, or equivalent), never a fixed role array in code — per rule #2, a second company's roles and approval chain don't have to look anything like ExpoCO's.
- Contract approval, Credit Note approval, and Contract Reduction approval already worked this way (`approval_rules` + `backend/src/utils/approverMatrix.js`, tiered by threshold, with backup approver / escalation / 2nd-step support) — **with no rule configured, any Admin/Management can act; Admin always can, regardless of tier.** This fallback is intentional and is disclosed directly in the Admin > Approval Rules UI, not hidden.
- Invoice Confirm, Credit Note Confirm, and Payment Record (create/edit/delete) were found to be the opposite: hardcoded to `['FIN']` in three controllers with **zero** admin exposure. Fixed by adding trigger types `INVOICE_CONFIRM`/`CREDIT_NOTE_CONFIRM`/`PAYMENT_RECORD` to the same Approval Rules screen, via new `getFinanceGateApprover`/`canActOnFinanceGate` in `approverMatrix.js`. These are **deliberately not** on the tiered-matrix path (`canActOnTier`) because that path grants Admin an automatic bypass on every tier — these three were previously Finance-only with Admin **explicitly excluded** per an earlier explicit instruction, and that exclusion must hold even once a rule is configured (no bypass), falling back to FIN-only when nothing is configured (unchanged prior behavior).
- The Approver "by role" `<select>` (main approver, escalation target, 2nd-step approver) must always be populated from the company's actual `roles` table, never a fixed option list — was hardcoded to Admin/Management-only options until this date, silently making Finance (or any other role) unselectable even where the backend fully supported it.
- When adding any new gated action, ask: could a second company want a different role, a specific named person, or nobody-but-Finance here? If yes, it belongs in `approval_rules`, exposed in Admin > Approval Rules, not a role array in a controller.

---

*This file is maintained by Claude across sessions per the user's instruction. Update it the moment a new standing rule or reversal is confirmed in conversation — don't wait to be asked twice.*
