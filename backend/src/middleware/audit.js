const { recordAudit, redact } = require('../utils/auditLog');

// Derives a stable entity_type from the request path — the first path
// segment after /api/, e.g. /api/sales-orders/:id/items -> 'sales-orders'.
function entityTypeFromPath(reqPath) {
  const parts = reqPath.replace(/^\/api\//, '').split('/');
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
  const seg = req.path.split('/').find((p) => UUID_RE.test(p));
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
      entityType: entityTypeFromPath(req.path),
      entityId: entityIdFromReq(req),
      details: { path: req.path, body: redact(req.body) },
    });
  });
  next();
}

module.exports = { auditMiddleware };
