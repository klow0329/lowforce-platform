const { recordAudit, redact } = require('../utils/auditLog');

// Derives a stable entity_type from the request path — the first path
// segment after /api/, e.g. /api/sales-orders/:id/items -> 'sales-orders'.
// MUST be given req.originalUrl, not req.path/req.url — Express rewrites
// req.path to be relative to whichever nested router currently owns the
// request as it descends the routing tree (e.g. '/d2ae...' instead of
// '/api/invoices/d2ae...' by the time this fires), and by the time
// res.on('finish') runs that rewritten value is what's left. originalUrl is
// the one property Express guarantees is never mutated — this was silently
// recording every single entry as entity_type 'unknown' until fixed.
function entityTypeFromPath(url) {
  const pathOnly = url.split('?')[0];
  const parts = pathOnly.replace(/^\/api\//, '').split('/');
  return parts[0] || 'unknown';
}

// Best-effort entity id: a route param that looks like an id, or the first
// UUID-shaped path segment.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function entityIdFromReq(req) {
  if (req.params) {
    for (const key of ['id', 'itemId', 'boothId', 'allocationId', 'type']) {
      if (req.params[key] && (UUID_RE.test(req.params[key]) || key === 'type')) return req.params[key];
    }
  }
  const seg = req.originalUrl.split('?')[0].split('/').find((p) => UUID_RE.test(p));
  return seg || null;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Fires on every successful state-changing API request — mounted once in
// server.js so every current AND future route gets an audit trail
// automatically, without each controller needing to remember to log
// itself. Login/logout are logged explicitly in auth.controller.js instead,
// since a login audit trail needs to record FAILURES too, which this
// only-log-on-success path deliberately skips (most mutations are only
// audit-worthy once they've actually happened).
function auditMiddleware(req, res, next) {
  if (!req.path.startsWith('/api/') || req.path === '/api/auth/login') return next();
  if (!MUTATING.has(req.method)) return next();

  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    const user = req.session && req.session.user;
    if (!user) return;
    recordAudit({
      companyId: user.company_id,
      userId: user.id,
      userName: user.full_name,
      roleCode: user.role_code,
      action: req.method,
      entityType: entityTypeFromPath(req.originalUrl),
      entityId: entityIdFromReq(req),
      details: { path: req.originalUrl, body: redact(req.body) },
    });
  });
  next();
}

module.exports = { auditMiddleware };
