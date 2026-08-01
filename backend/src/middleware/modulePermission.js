const { pool } = require('../config/db');

// Company-defined departments (see roles.permissions, admin.controller.js's
// role CRUD) can be granted view/add/edit on a small set of core modules —
// 'add' means create-only: new records are allowed, but existing ones can't
// be amended/overwritten, per the user's own explicit requirement.
//
// This is a purely ADDITIVE, RESTRICTIVE layer on top of every existing
// role_code check already scattered through the codebase (ADM/MGT/FIN/etc.)
// — it never grants access those checks would otherwise deny, it only ever
// narrows it further. Two things keep every pre-existing role's behavior
// unchanged: Admin is always exempt (matches every existing elevated
// check), and a role with no entry at all for this module (permissions[m]
// is undefined — true for every role that predates this feature, since
// they were all seeded with permissions = {}) falls through to next()
// untouched. Only a role that has EXPLICITLY been given a permission level
// for this specific module (via the new Admin > Departments screen) is
// actually gated.
const ACTION_RANK = { view: 1, add: 2, edit: 3 };

// A user's own access_level_override (Admin > Users, see auth.controller.js
// and middleware/tenant.js's req.accessLevelOverride) is a simple,
// whole-account setting — not per-module like the Department matrix above.
// When set, it overrides that Department matrix across every module gated
// by requireModulePermission, checked first below; when unset (Default) it
// falls through to the existing Department-matrix lookup unchanged.
const OVERRIDE_RANK = { VIEW_ONLY: 1, VIEW_ADD: 2, FULL_EDIT: 3 };

function requireModulePermission(moduleName, action) {
  return async function (req, res, next) {
    if (req.roleCode === 'ADM') return next();

    if (req.accessLevelOverride) {
      if ((OVERRIDE_RANK[req.accessLevelOverride] || 0) < ACTION_RANK[action]) {
        const verb = action === 'edit' ? 'edit' : 'add new';
        return res.status(403).json({ error: `Your account's access level doesn't allow you to ${verb} ${moduleName}.` });
      }
      return next();
    }

    const result = await pool.query(
      `SELECT permissions FROM roles WHERE company_id = $1 AND code = $2`,
      [req.companyId, req.roleCode]
    );
    const granted = result.rows[0]?.permissions?.[moduleName];
    if (!granted) return next();
    if ((ACTION_RANK[granted] || 0) < ACTION_RANK[action]) {
      const verb = action === 'edit' ? 'edit' : 'add new';
      return res.status(403).json({ error: `Your role doesn't have permission to ${verb} ${moduleName}.` });
    }
    next();
  };
}

module.exports = { requireModulePermission };
