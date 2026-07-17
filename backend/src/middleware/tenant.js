// This is the single most important piece of the multi-tenant design.
//
// Every logged-in user belongs to exactly one company (companies.id). This
// middleware reads that company_id from their session — never from
// anything the browser sends, so a user can't fake a different
// company_id — and attaches it to req.companyId.
//
// Every controller that touches company-scoped data (exhibitors,
// opportunities, invoices, etc.) MUST filter its query by req.companyId.
// That single rule is what guarantees no cross-company data leakage,
// enforced at the query level rather than just hidden in the UI, per the
// plan's Section 5 security baseline.
function attachTenant(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Not logged in.' });
  }
  req.companyId = req.session.user.company_id;
  req.userId = req.session.user.id;
  next();
}

module.exports = { attachTenant };
